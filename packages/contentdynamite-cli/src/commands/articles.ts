import type { Command } from 'commander';
import type { ApiClient, Params } from '../client';
import type { Cli } from '../context';
import { readText, writeFile } from '../files';
import { decimal, documentOutput, downloadDocument, either, Exit, fmtNum, integer, interactiveFields, splitCsv, watchLoop } from '../helpers';
import { err, isoNow, line, out, write } from '../output';
import {
	INTERACTIVE_TYPES,
	wireStatus,
	type ArticleDoneRes,
	type ArticlePendingRes,
	type CleanProvenanceRes,
	type EmbedAuditRes,
	type ListicleResearchPromptRes,
	type PaginatedArticlesRes,
	type ProvenanceAuditRes,
	type WriteArticleRes,
} from '../wire';

export type ArticleRes = ArticleDoneRes | ArticlePendingRes;

interface WriteOptions {
	profileId: number;
	query: string;
	primaryKeywords: string;
	secondaryKeywords?: string;
	location?: string;
	guidelines?: string;
	imageGuideline?: string;
	internalLinks?: string;
	externalLinks?: string;
	competitorLinks?: string;
	brandFacts?: string;
	infographic?: boolean;
	video?: boolean;
	interactive?: string | boolean;
	dewatermark?: boolean;
	listicle?: boolean;
	researchFile?: string;
	itemCount?: number;
	competitors?: string;
}

interface UpdateOptions {
	title?: string;
	slug?: string;
	intro?: string;
	body?: string;
	bodyFile?: string;
	faqs?: string;
	faqsFile?: string;
	featImage?: string;
}

interface AuditOptions {
	page: number;
	limit: number;
}

interface CleanOptions {
	rewrite?: boolean;
	dryRun?: boolean;
	watch?: boolean;
	interval: number;
	timeout: number;
}

interface ListOptions {
	page: number;
	limit: number;
	company?: string;
	status?: string;
	batchId?: number;
}

const media = (article: ArticleRes, field: 'video_status' | 'interactive_status') => (article.status === 'success' ? article[field] : null) ?? 'null';

function isTerminal(article: ArticleRes): boolean {
	if (article.status === 'failed') return true;
	if (article.status !== 'success') return false;
	return article.video_status !== 'pending' && article.interactive_status !== 'pending';
}

function limitedList(value: string, name: string, max: number): string[] {
	const items = splitCsv(value);
	if (items.length > max) throw new Error(`${name} max out at ${max}, got ${items.length}`);
	return items;
}

export async function everyArticle(client: ApiClient, filter: Params): Promise<ArticleRes[]> {
	const articles: ArticleRes[] = [];
	for (let page = 1; ; page++) {
		const res = await client.get<PaginatedArticlesRes>('content-writing/articles', { page, limit: 100, ...filter });
		articles.push(...res.articles);
		if (page >= res.total_pages || res.articles.length === 0) return articles;
	}
}

function writeBody(options: WriteOptions): Record<string, unknown> {
	const body: Record<string, unknown> = { company_profile_id: options.profileId, search_query: options.query, primary_keywords: options.primaryKeywords };
	if (options.secondaryKeywords) body.secondary_keywords = options.secondaryKeywords;
	if (options.location) body.location_to_rank_for = options.location;
	if (options.guidelines) body.extra_guidelines = options.guidelines;
	if (options.imageGuideline) body.image_guideline = options.imageGuideline;
	if (options.internalLinks) body.internal_links = splitCsv(options.internalLinks);
	if (options.externalLinks) body.external_links = limitedList(options.externalLinks, 'external links', 5);
	if (options.competitorLinks) body.competitor_links = limitedList(options.competitorLinks, 'competitor links', 3);
	if (options.brandFacts) body.brand_facts = options.brandFacts;
	if (options.infographic) body.infographic_feat_image = true;
	if (options.video) body.generate_video = true;
	Object.assign(body, interactiveFields(options.interactive));
	if (options.dewatermark !== undefined) {
		body.dewatermark = options.dewatermark;
		if (options.dewatermark) err("--dewatermark adds one rewrite call per article and trades some of Claude's voice for hygiene.");
	}
	if (options.listicle) {
		if (options.researchFile === undefined) throw new Error('--listicle needs --research-file: paste the research from `ve-dynamite articles research-prompt` into a file first');
		body.article_type = 'listicle';
		body.listicle_research = readText(options.researchFile);
	} else if (options.researchFile !== undefined) {
		throw new Error('--research-file only applies with --listicle');
	}
	if (options.itemCount !== undefined) body.item_count = options.itemCount;
	if (options.competitors) body.allowed_competitors = splitCsv(options.competitors);
	return body;
}

function updateBody(options: UpdateOptions): Record<string, string> {
	const body = either(options.body, options.bodyFile, '--body or --body-file');
	const faqs = either(options.faqs, options.faqsFile, '--faqs or --faqs-file');
	const payload: Record<string, string> = {};
	if (options.title) payload.title = options.title;
	if (options.slug) payload.slug = options.slug;
	if (options.intro) payload.intro = options.intro;
	if (body) payload.body = body;
	if (faqs) payload.faqs = faqs;
	if (options.featImage) payload.feat_image = options.featImage;
	if (Object.keys(payload).length === 0) {
		throw new Error('nothing to update, pass at least one of --title, --slug, --intro, --body, --body-file, --faqs, --faqs-file, --feat-image');
	}
	return payload;
}

export function registerArticles(program: Command, cli: Cli): Command {
	const articles = program.command('articles').description('Manage articles');

	articles
		.command('write')
		.description('Queue an article for generation (async, costs real money per article)')
		.requiredOption('--profile-id <id>', 'Company profile id', integer)
		.requiredOption('--query <query>', 'Search query the article should target')
		.requiredOption('--primary-keywords <keywords>', 'Primary keywords')
		.option('--secondary-keywords <keywords>', 'Secondary keywords')
		.option('--location <location>', 'Location to rank for')
		.option('--guidelines <text>', 'Extra writing guidelines')
		.option('--image-guideline <text>', 'Featured image guideline')
		.option('--internal-links <urls>', "Comma separated URLs on the company's own site that must be linked")
		.option('--external-links <urls>', 'Comma separated outside sources the article must cite (max 5)')
		.option('--competitor-links <urls>', 'Comma separated competitor URLs (max 3)')
		.option('--brand-facts <text>', 'Verified facts about the client the article may state, such as the CLIENT FACTS block from research-prompt')
		.option('--infographic', 'Generate the featured image as an infographic')
		.option('--video', 'Generate a companion video')
		.option('--interactive [type]', `Generate an interactive component, optionally ${INTERACTIVE_TYPES.join('|')} (bare flag lets the server auto select)`)
		.option('--dewatermark', 'Rewrite the finished prose through a non-Claude model. Omit to follow DEWATERMARK_REWRITE_ENABLED')
		.option('--no-dewatermark', 'Keep the prose as written, whatever DEWATERMARK_REWRITE_ENABLED says')
		.option('--listicle', 'Write a structured listicle. Requires --research-file')
		.option('--research-file <path>', 'File holding the research and source links a listicle is built from')
		.option('--item-count <count>', 'How many options the listicle should cover (3 to 10)', integer)
		.option('--competitors <names>', 'Comma separated list of the only competitors a listicle may name')
		.action(async (options: WriteOptions) => {
			const res = await cli.client().post<WriteArticleRes>('content-writing/article', writeBody(options));
			cli.billed(1);
			err(`Generation is asynchronous and spends real money (LLM, SERP, crawling, images). Poll with ${cli.follow(`articles watch ${res.article_id}`, `articles get ${res.article_id}`)}`);
			out(res);
		});

	articles
		.command('research-prompt')
		.description('Print the research prompt to run in an external AI tool before writing a listicle')
		.requiredOption('--profile-id <id>', 'Company profile id, names the client in the prompt', integer)
		.requiredOption('--keyword <keyword>', 'The keyword the listicle targets')
		.option('--title <title>', 'Working title, defaults to the keyword')
		.option('--location <location>', 'Location the reader is in')
		.option('--item-count <count>', 'How many options to research (3 to 10)', integer)
		.action(async (options: { profileId: number; keyword: string; title?: string; location?: string; itemCount?: number }) => {
			const res = await cli.client().get<ListicleResearchPromptRes>('content-writing/listicle-research-prompt', {
				keyword: options.keyword,
				profile_id: options.profileId,
				title: options.title,
				location: options.location,
				item_count: options.itemCount,
			});
			err(`Research prompt for ${res.company_name}. Paste the CLIENT FACTS block into --brand-facts, the rest into --research-file.`);
			line(res.prompt);
		});

	documentOutput(
		articles
			.command('download')
			.description('Download a finished article as a document (docx imports straight into Google Docs)')
			.argument('<ID>', 'Article id', integer)
			.option('--format <format>', 'docx (opens in Google Docs) or md', 'docx'),
		cli,
	).action(async (articleId: number, options: { format: string; output?: string }) => {
		const target = await downloadDocument(cli, `content-writing/article/${articleId}/export`, options.format, options.output, `article-${articleId}`);
		err(`exported article ${articleId} to ${target}`);
	});

	articles
		.command('get')
		.description('Show one article (slim {article_id, status} shape until the article completes)')
		.argument('<ID>', 'Article id', integer)
		.action(async (articleId: number) => out(await cli.client().get(`content-writing/article/${articleId}`)));

	articles
		.command('list')
		.description('List articles, newest first')
		.option('--page <page>', 'Page number', integer, 1)
		.option('--limit <limit>', 'Page size (max 100)', integer, 10)
		.option('--company <name>', 'Filter by exact company name')
		.option('--status <status>', 'Filter by status: pending, success, failed')
		.option('--batch-id <id>', 'Filter by batch id', integer)
		.action(async (options: ListOptions) => {
			const status = wireStatus(options.status);
			out(await cli.client().get('content-writing/articles', { page: options.page, limit: options.limit, company_name: options.company, status, batch_id: options.batchId }));
		});

	if (!cli.mount) {
		articles
			.command('watch')
			.description('Poll an article until the write AND any requested video/interactive are terminal')
			.argument('<ID>', 'Article id', integer)
			.option('--interval <seconds>', 'Seconds between polls', decimal, 10)
			.option('--timeout <seconds>', 'Give up after this many seconds', decimal)
			.action(async (articleId: number, options: { interval: number; timeout?: number }) => {
				const client = cli.client();
				const article = await watchLoop<ArticleRes>({
					interval: options.interval,
					timeout: options.timeout,
					poll: () => client.get(`content-writing/article/${articleId}`),
					progress: (item) => `[${isoNow()}] status=${item.status} video=${media(item, 'video_status')} interactive=${media(item, 'interactive_status')}`,
					done: isTerminal,
					timedOut: (item) => `timed out after ${fmtNum(options.timeout!)}s, article ${articleId} still ${item.status}`,
				});
				out(article);
				if (article.status === 'failed') throw new Exit(1);
			});
	}

	articles
		.command('update')
		.description('Update article fields (409 while the article is still being written)')
		.argument('<ID>', 'Article id', integer)
		.option('--title <title>', 'New title')
		.option('--slug <slug>', 'New slug')
		.option('--intro <intro>', 'New intro')
		.option('--body <markdown>', 'New body markdown')
		.option('--body-file <path>', 'Read the new body from a file')
		.option('--faqs <faqs>', 'New FAQs')
		.option('--faqs-file <path>', 'Read the new FAQs from a file')
		.option('--feat-image <url>', 'New featured image URL')
		.action(async (articleId: number, options: UpdateOptions) => out(await cli.client().put(`content-writing/article/${articleId}`, updateBody(options))));

	articles
		.command('embed-audit')
		.description('List completed articles whose body still has the interactive block welded in (read only)')
		.option('--limit <limit>', 'Articles to scan per page', integer, 50)
		.option('--page <page>', 'Page of completed articles to scan', integer, 1)
		.action(async (options: AuditOptions) => {
			const res = await cli.client().get<EmbedAuditRes>('content-writing/articles/interactive-embed-audit', { page: options.page, limit: options.limit });
			if (res.articles.length === 0) {
				err(`Scanned ${res.total_success} completed article(s), none carry a welded embed.`);
			} else {
				err(`${res.articles.length} article(s) still carry the block inside the body:`);
				for (const item of res.articles) {
					err(`  #${item.article_id} [${item.company_name}] ${item.interactive_type} (${item.payload_stored ? 'payload stored' : 'NO PAYLOAD — leave alone'})`);
				}
			}
			out(res);
		});

	articles
		.command('strip-embeds')
		.summary('Take the interactive block out of shipped bodies, leaving the payload (no spend)')
		.description(
			'Take the interactive block out of shipped bodies, leaving the payload (no spend)\n\n' +
				'The component then comes from `interactive_embed` on the API instead, which is what lets a site place it. ' +
				'Run this only once whoever renders these articles reads that field: until then the block in the body is what a reader sees.',
		)
		.argument('[ID]', 'Omit to strip every article you own', integer)
		.option('--dry-run', 'Only list what would be stripped, change nothing')
		.action(async (articleId: number | undefined, options: { dryRun?: boolean }) => {
			const client = cli.client();
			if (options.dryRun) {
				const res = await client.get<EmbedAuditRes>('content-writing/articles/interactive-embed-audit', { limit: 200 });
				const targets = res.articles.filter((item) => articleId === undefined || item.article_id === articleId);
				err(`would strip ${targets.length} article(s): ${targets.map((item) => `#${item.article_id}`).join(', ') || 'none'}`);
				out({ would_strip: targets.map((item) => item.article_id) });
				return;
			}
			out(await client.post('content-writing/articles/strip-interactive-embeds', articleId === undefined ? null : [articleId]));
		});

	articles
		.command('provenance-audit')
		.description('List completed articles still carrying invisible characters (read only, no spend)')
		.option('--limit <limit>', 'Articles to scan per page', integer, 50)
		.option('--page <page>', 'Page of completed articles to scan', integer, 1)
		.action(async (options: AuditOptions) => {
			const res = await cli.client().get<ProvenanceAuditRes>('content-writing/articles/provenance-audit', { page: options.page, limit: options.limit });
			if (res.articles.length === 0) {
				err(`Scanned ${res.checked} completed article(s), none carry invisible characters.`);
			} else {
				err(`${res.articles.length} of ${res.checked} scanned article(s) carry invisible characters:`);
				for (const item of res.articles) {
					const classes = [...new Set(Object.values(item.findings).flatMap((counts) => Object.keys(counts)))].sort();
					err(`  #${item.article_id} [${item.company_name}] ${item.total_findings} char(s): ${classes.join(', ')}`);
				}
			}
			out(res);
		});

	const clean = articles
		.command('clean-provenance')
		.description('Strip invisible characters from shipped articles in place (deterministic, no spend without --rewrite)')
		.argument('[ID]', 'Omit to clean every flagged article', integer)
		.option('--rewrite', 'Also run the Layer B prose rewrite. Costs an LLM call and some voice')
		.option('--dry-run', 'Only list what would be cleaned, change nothing');
	if (!cli.mount) {
		clean
			.option('--watch', 'After cleaning, poll the audit until it comes back clean')
			.option('--interval <seconds>', 'Seconds between audit polls with --watch', decimal, 15)
			.option('--timeout <seconds>', 'Give up polling after this many seconds with --watch', decimal, 300);
	}
	clean.action(async (articleId: number | undefined, options: CleanOptions) => {
		const client = cli.client();
		const audit = { limit: 200 };
		const rewrite = options.rewrite ? { rewrite: true } : undefined;
		if (options.rewrite) {
			err('--rewrite sends the prose to the configured non-Claude model. It costs a call per article and');
			err("the rewrite model's word choices replace Claude's. It cannot be certified against any detector.");
		}
		if (articleId !== undefined) {
			if (options.dryRun) {
				err(`would clean article #${articleId}`);
				return;
			}
			const res = await client.post(`content-writing/article/${articleId}/clean-provenance`, undefined, rewrite);
			if (rewrite) cli.billed(1);
			out(res);
			return;
		}
		const flagged = await client.get<ProvenanceAuditRes>('content-writing/articles/provenance-audit', audit);
		if (flagged.articles.length === 0) {
			err(`Scanned ${flagged.checked} completed article(s), nothing to clean.`);
			out(flagged);
			return;
		}
		err(`${flagged.articles.length} article(s) carry invisible characters:`);
		for (const item of flagged.articles) err(`  #${item.article_id} [${item.company_name}] ${item.total_findings} char(s)`);
		if (options.dryRun) {
			out(flagged);
			return;
		}
		const cleaned: CleanProvenanceRes[] = [];
		try {
			for (const item of flagged.articles) {
				const res = await client.post<CleanProvenanceRes>(`content-writing/article/${item.article_id}/clean-provenance`, undefined, rewrite);
				cleaned.push(res);
				err(`cleaned #${item.article_id}: ${res.msg}`);
			}
		} finally {
			if (rewrite) cli.billed(cleaned.length);
		}
		if (!options.watch) {
			out({ cleaned });
			return;
		}
		out(
			await watchLoop<ProvenanceAuditRes>({
				interval: options.interval,
				timeout: options.timeout,
				poll: () => client.get('content-writing/articles/provenance-audit', audit),
				progress: (res) => `[${isoNow()}] articles still carrying carriers: ${res.articles.length}`,
				done: (res) => res.articles.length === 0,
				timedOut: (res) => `timed out after ${fmtNum(options.timeout)}s, ${res.articles.length} article(s) still flagged`,
			}),
		);
	});

	articles
		.command('delete')
		.description('Delete an article permanently')
		.argument('<ID>', 'Article id', integer)
		.option('--yes', 'Confirm the deletion')
		.action(async (articleId: number, options: { yes?: boolean }) => {
			if (!options.yes) throw new Error('deleting an article is permanent, re-run with --yes to confirm');
			out(await cli.client().delete(`content-writing/article/${articleId}`));
		});

	articles
		.command('export')
		.description('Export all matching articles via client side paging')
		.option('--company <name>', 'Filter by exact company name')
		.option('--status <status>', 'Filter by status: pending, success, failed')
		.option('--batch-id <id>', 'Filter by batch id', integer)
		.option('--ndjson', 'Newline delimited JSON instead of an array')
		.option('-o, --output <path>', 'Write to a file instead of stdout')
		.action(async (options: { company?: string; status?: string; batchId?: number; ndjson?: boolean; output?: string }) => {
			const status = wireStatus(options.status);
			const found = await everyArticle(cli.client(), { company_name: options.company, status, batch_id: options.batchId });
			const text = options.ndjson ? found.map((article) => `${JSON.stringify(article)}\n`).join('') : JSON.stringify(found, null, 2);
			if (!options.output) {
				write(text);
				return;
			}
			writeFile(options.output, text);
			err(`exported ${found.length} articles to ${options.output}`);
		});

	return articles;
}
