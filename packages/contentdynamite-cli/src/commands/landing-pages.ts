import { basename } from 'node:path';
import { type Command, Option } from 'commander';
import type { ApiClient } from '../client';
import type { Cli } from '../context';
import { readBytes, readText, writeFile } from '../files';
import { between, decimal, either, Exit, fmtNum, integer, splitCsv, watchLoop } from '../helpers';
import { err, isoNow, line, out, write } from '../output';
import { wireDeliverable, wireLandingStatus, type ImageAuditItem, type LandingPageDoneRes, type LandingPagePendingRes } from '../wire';

type LandingRes = LandingPageDoneRes | LandingPagePendingRes;

interface AuditRes {
	landing_pages: ImageAuditItem[];
	checked: number;
	total_success: number;
	page: number;
	limit: number;
}

interface CriteriaReport {
	criteria?: { id: string; need: string; deal_breaker?: boolean }[];
	coverage?: { id: string; status?: string }[];
	dismissed_ids?: string[];
	met?: number;
	total?: number;
	unmet_unsupported?: string[];
	research?: { added?: unknown[] };
}

interface ResearchPool {
	keyword?: string;
	questions?: { q: string; freq?: number }[];
	seeds?: unknown[];
	fetched_at?: string;
	degraded?: boolean;
	spend?: { calls?: number; cached?: number; skipped?: number; failed?: number };
}

interface WriteOptions {
	profileId: number;
	keyword: string;
	brief?: string;
	briefFile?: string;
	deliverable: string;
	ctaLabel?: string;
	ctaUrl?: string;
	secondaryKeywords?: string;
	intentWho?: string;
	intentWant?: string;
	intentAchieve?: string;
	brandFacts?: string;
	writingGuide?: string;
	writingGuideFile?: string;
	imageUrls?: string;
	images?: boolean;
	designZip?: string;
	designZipUrl?: string;
	allowedTerms?: string;
	goldenUrl?: string;
	socialProof?: string;
	socialProofRating?: number;
	pageType?: string;
}

interface UpdateOptions {
	slug?: string;
	titleTag?: string;
	metaDescription?: string;
	h1?: string;
	ctaLabel?: string;
	ctaUrl?: string;
	copyFile?: string;
}

interface FixOptions {
	dryRun?: boolean;
	watch?: boolean;
	interval: number;
	timeout: number;
}

const isTerminal = (page: LandingRes) => page.status === 'success' || page.status === 'failed';

const evalOf = (page: LandingRes) => ('eval_status' in page ? page.eval_status : null) ?? 'null';

const progress = (page: LandingRes) => `[${isoNow()}] status=${page.status} eval=${evalOf(page)}`;

const criteriaOf = (page: LandingRes) => (('eval_report' in page ? page.eval_report?.reader_criteria : null) ?? {}) as CriteriaReport;

function followPage(client: ApiClient, lpId: number): Promise<LandingRes> {
	return watchLoop<LandingRes>({
		interval: 10,
		timeout: 900,
		poll: () => client.get(`landing-pages/${lpId}`),
		progress,
		done: isTerminal,
		timedOut: (page) => `timed out, landing page ${lpId} still ${page.status}`,
	});
}

async function writeBody(client: ApiClient, options: WriteOptions): Promise<Record<string, unknown>> {
	const guide = either(options.writingGuide, options.writingGuideFile, '--writing-guide or --writing-guide-file');
	const brief = either(options.brief, options.briefFile, '--brief or --brief-file');
	const body: Record<string, unknown> = { company_profile_id: options.profileId, keyword: options.keyword, deliverable: wireDeliverable(options.deliverable) };
	if (brief) body.page_brief = brief;
	if (options.ctaLabel) body.cta_label = options.ctaLabel;
	if (options.ctaUrl) body.cta_url = options.ctaUrl;
	if (options.secondaryKeywords) {
		const keywords = splitCsv(options.secondaryKeywords);
		if (keywords.length > 2) throw new Error(`secondary keywords max out at 2, got ${keywords.length}`);
		body.secondary_keywords = keywords;
	}
	const intent = { who: options.intentWho, want: options.intentWant, achieve: options.intentAchieve };
	if (Object.values(intent).some(Boolean)) {
		if (!Object.values(intent).every(Boolean)) throw new Error('pass all three of --intent-who, --intent-want, --intent-achieve or none');
		body.intent = intent;
	}
	if (options.brandFacts) body.brand_facts = options.brandFacts;
	if (guide) body.writing_guide = guide;
	if (options.imageUrls) body.image_urls = splitCsv(options.imageUrls);
	body.generate_images = options.images !== false;
	if (options.allowedTerms) body.allowed_terms = splitCsv(options.allowedTerms);
	if (options.goldenUrl) body.golden_url = options.goldenUrl;
	if (options.socialProof) body.social_proof = { text: options.socialProof, rating: options.socialProofRating ?? null };
	else if (options.socialProofRating !== undefined) throw new Error('--social-proof-rating needs --social-proof: a rating with no claim beside it is meaningless');
	if (options.designZip && options.designZipUrl) throw new Error('pass either --design-zip or --design-zip-url, not both');
	if (options.designZip) {
		const zip = new Blob([readBytes(options.designZip)], { type: 'application/zip' });
		const stored = await client.postForm<{ design_zip_key: string; design_zip_name: string }>('landing-pages/design-zips', zip, basename(options.designZip));
		body.design_zip_key = stored.design_zip_key;
		body.design_zip_name = stored.design_zip_name;
	} else if (options.designZipUrl) {
		body.design_zip_url = options.designZipUrl;
	}
	return body;
}

function updateBody(options: UpdateOptions): Record<string, unknown> {
	const payload: Record<string, unknown> = {};
	if (options.slug) payload.slug = options.slug;
	if (options.titleTag) payload.title_tag = options.titleTag;
	if (options.metaDescription) payload.meta_description = options.metaDescription;
	if (options.h1) payload.h1 = options.h1;
	if (options.ctaLabel) payload.cta_label = options.ctaLabel;
	if (options.ctaUrl) payload.cta_url = options.ctaUrl;
	if (options.copyFile) payload.copy_payload = JSON.parse(readText(options.copyFile));
	if (Object.keys(payload).length === 0) {
		throw new Error('nothing to update, pass at least one of --slug, --title-tag, --meta-description, --h1, --cta-label, --cta-url, --copy-file');
	}
	return payload;
}

function auditWatch(client: ApiClient, path: string, params: Record<string, string | number>, options: FixOptions, still: string): Promise<AuditRes> {
	return watchLoop<AuditRes>({
		interval: options.interval,
		timeout: options.timeout,
		poll: () => client.get(path, params),
		progress: (audit) => `[${isoNow()}] pages still ${still}: ${audit.landing_pages.length}`,
		done: (audit) => audit.landing_pages.length === 0,
		timedOut: (audit) => `timed out after ${fmtNum(options.timeout)}s, ${audit.landing_pages.length} page(s) still ${still}`,
	});
}

function writeText(text: string, output: string | undefined, lpId: number): void {
	if (!output) {
		write(text);
		return;
	}
	writeFile(output, text);
	err(`exported landing page ${lpId} to ${output}`);
}

export function registerLandingPages(program: Command, cli: Cli): void {
	const landing = program.command('landing-pages').description('Manage BOFU SEO landing pages');

	landing
		.command('write')
		.description('Queue a landing page for generation (async, costs real money per page)')
		.requiredOption('--profile-id <id>', 'Company profile id', integer)
		.requiredOption('--keyword <keyword>', 'The purchase intent keyword this page targets')
		.option('--brief <text>', 'What this page should do, in your own words. The angle, a section it must carry, a client correction that outranks their live site')
		.option('--brief-file <path>', 'Read the page brief from a file')
		.option('--deliverable <deliverable>', 'copy (a copy deck, the default) | page (also build and host the web page)', 'copy')
		.option('--cta-label <label>', 'Call to action button label. Left out, the engine writes one from the keyword and the ICP')
		.option('--cta-url <url>', 'Call to action destination URL')
		.option('--secondary-keywords <keywords>', 'Comma separated secondary keywords (max 2)')
		.option('--intent-who <text>', 'Who is searching this keyword (skips the intent LLM step when all three intent flags are set)')
		.option('--intent-want <text>', 'What the searcher wants')
		.option('--intent-achieve <text>', 'What the searcher is trying to achieve')
		.option('--brand-facts <text>', 'Verified brand facts the writer may state')
		.option('--writing-guide <text>', 'Brand writing guide (source of truth over generic style rules)')
		.option('--writing-guide-file <path>', 'Read the writing guide from a file')
		.option('--image-urls <urls>', "Comma separated image URLs, taking the slots in order. Each is rehosted to the CDN. Remaining slots are filled from the client's design system and their own site")
		.option('--images', 'Has no effect: the Worker never generates a landing page image. Kept so older scripts still run')
		.option('--no-images', 'Has no effect, see --images')
		.option('--design-zip <path>', "The client's design system zip, for this page only. Stored privately, then the page renders in it. The profile's own design system is used when this is left out")
		.option('--design-zip-url <url>', 'An https link the worker downloads the design system zip from')
		.option('--allowed-terms <terms>', 'Comma separated banned-list exceptions for this page')
		.option('--golden-url <url>', 'URL of a golden reference page for the judge')
		.option('--social-proof <text>', "A real proof line beside the hero CTA, e.g. 'trusted by 400 contractors'")
		.option('--social-proof-rating <rating>', 'A real average rating, 1 to 5. Stars render only when this is given', between(1, 5))
		.addOption(new Option('--page-type <type>', 'Has no effect: the Worker chooses the layout. Kept so older scripts still run').hideHelp())
		.action(async (options: WriteOptions) => {
			if (options.pageType) err('--page-type has no effect, the Worker chooses the layout');
			const client = cli.client();
			const res = await client.post<{ landing_page_id: number }>('landing-pages/', await writeBody(client, options));
			cli.billed(1);
			err(`Generation is asynchronous and spends real money (LLM, SERP). Poll with ${cli.follow(`landing-pages watch ${res.landing_page_id}`, `landing-pages get ${res.landing_page_id}`)}`);
			out(res);
		});

	landing
		.command('research')
		.description("Show the SERP research a page's FAQs were chosen from")
		.argument('<ID>', 'Landing page id', integer)
		.option('--json', 'Emit the raw pool instead of the summary')
		.action(async (lpId: number, options: { json?: boolean }) => {
			const page = await cli.client().get<LandingRes>(`landing-pages/${lpId}`);
			const pool = ('research_pool' in page ? page.research_pool : null) as ResearchPool | null;
			if (!pool || Object.keys(pool).length === 0) {
				err(`Landing page ${lpId} carries no research (generated before research was stored, or the SERP pull failed)`);
				return;
			}
			if (options.json) {
				out(pool);
				return;
			}
			const spend = pool.spend ?? {};
			err(`keyword: ${pool.keyword}  ·  ${pool.questions?.length ?? 0} questions from ${pool.seeds?.length ?? 0} seed searches  ·  pulled ${pool.fetched_at}`);
			err(`spend: ${spend.calls ?? 0} billed, ${spend.cached ?? 0} cached, ${spend.skipped ?? 0} skipped, ${spend.failed ?? 0} failed${pool.degraded ? '  (DEGRADED)' : ''}`);
			for (const question of pool.questions ?? []) {
				const freq = question.freq ?? 1;
				line(`  ${freq > 1 ? `x${freq}` : '  '}  ${question.q}`);
			}
		});

	landing
		.command('get')
		.description('Show one landing page (slim {landing_page_id, status} shape until it completes)')
		.argument('<ID>', 'Landing page id', integer)
		.action(async (lpId: number) => out(await cli.client().get(`landing-pages/${lpId}`)));

	landing
		.command('list')
		.description('List landing pages, newest first')
		.option('--page <page>', 'Page number', integer, 1)
		.option('--limit <limit>', 'Page size (max 100)', integer, 10)
		.option('--company <name>', 'Filter by exact company name')
		.option('--status <status>', 'Filter by status: pending, success, failed')
		.action(async (options: { page: number; limit: number; company?: string; status?: string }) => {
			const status = wireLandingStatus(options.status);
			out(await cli.client().get('landing-pages/', { page: options.page, limit: options.limit, company_name: options.company, status }));
		});

	if (!cli.mount) {
		landing
			.command('watch')
			.description('Poll a landing page until generation is terminal (success or failed)')
			.argument('<ID>', 'Landing page id', integer)
			.option('--interval <seconds>', 'Seconds between polls', decimal, 10)
			.option('--timeout <seconds>', 'Give up after this many seconds', decimal)
			.action(async (lpId: number, options: { interval: number; timeout?: number }) => {
				const client = cli.client();
				const page = await watchLoop<LandingRes>({
					interval: options.interval,
					timeout: options.timeout,
					poll: () => client.get(`landing-pages/${lpId}`),
					progress,
					done: isTerminal,
					timedOut: (item) => `timed out after ${fmtNum(options.timeout!)}s, landing page ${lpId} still ${item.status}`,
				});
				out(page);
				if (page.status === 'failed') throw new Exit(1);
			});
	}

	landing
		.command('update')
		.description('Update copy fields and re-render the HTML in place (409 while still generating)')
		.argument('<ID>', 'Landing page id', integer)
		.option('--slug <slug>', 'New slug')
		.option('--title-tag <text>', 'New title tag')
		.option('--meta-description <text>', 'New meta description')
		.option('--h1 <text>', 'New H1')
		.option('--cta-label <label>', 'New CTA label')
		.option('--cta-url <url>', 'New CTA URL')
		.option('--copy-file <path>', 'Replace the copy deck from a JSON file (the shape returned by export --copy)')
		.action(async (lpId: number, options: UpdateOptions) => out(await cli.client().put(`landing-pages/${lpId}`, updateBody(options))));

	landing
		.command('audit')
		.description('List completed pages whose deliverable still fails the image gate or carries placeholder markers')
		.option('--checks <checks>', 'Comma separated subset of: images, placeholders', 'images,placeholders')
		.option('--limit <limit>', 'How many completed pages to scan', integer, 100)
		.action(async (options: { checks: string; limit: number }) => out(await cli.client().get('landing-pages/audit', { checks: options.checks, limit: options.limit })));

	const fixPlaceholders = landing
		.command('fix-placeholders')
		.description('Strip unresolved placeholder markers from completed pages and re-render them (deterministic, no LLM, no spend)')
		.option('--dry-run', 'Only list the pages carrying placeholder markers, change nothing');
	if (!cli.mount) {
		fixPlaceholders
			.option('--watch', 'After fixing, poll the audit until it comes back clean')
			.option('--interval <seconds>', 'Seconds between audit polls with --watch', decimal, 15)
			.option('--timeout <seconds>', 'Give up polling after this many seconds with --watch', decimal, 300);
	}
	fixPlaceholders.action(async (options: FixOptions) => {
		const client = cli.client();
		const params = { checks: 'placeholders', limit: 100 };
		const audit = await client.get<AuditRes>('landing-pages/audit', params);
		if (audit.landing_pages.length === 0) {
			err('All completed landing pages are free of placeholder markers. Nothing to fix.');
			out(audit);
			return;
		}
		err(`${audit.landing_pages.length} landing page(s) carry unresolved placeholder markers:`);
		for (const item of audit.landing_pages) err(`  #${item.landing_page_id} [${item.company_name}] ${item.keyword} (${item.placeholder_failures.length} marker(s))`);
		if (options.dryRun) {
			out(audit);
			return;
		}
		const fixed: { removed?: unknown[] }[] = [];
		for (const item of audit.landing_pages) {
			const res = await client.post<{ removed?: unknown[] }>(`landing-pages/${item.landing_page_id}/fix-placeholders`);
			fixed.push(res);
			err(`cleaned #${item.landing_page_id}: ${res.removed?.length ?? 0} unit(s) rewritten or dropped`);
		}
		if (!options.watch) {
			out({ fixed });
			return;
		}
		out(await auditWatch(client, 'landing-pages/audit', params, options, 'carrying markers'));
	});

	landing
		.command('rebrand')
		.description("Re-render completed pages in their company's current brand (deterministic, no LLM, no spend)")
		.argument('[ID]', 'One landing page. Omit and pass --company to do a whole company', integer)
		.option('--company <name>', 'Rebrand every completed page for this exact company name')
		.option('--limit <limit>', "Page size when listing a company's pages", integer, 100)
		.option('--dry-run', 'List what would be re-rendered, change nothing')
		.action(async (lpId: number | undefined, options: { company?: string; limit: number; dryRun?: boolean }) => {
			if (lpId === undefined && !options.company) {
				err('Pass a landing page ID or --company.');
				throw new Exit(1);
			}
			const client = cli.client();
			let targets: { landing_page_id: number; keyword: string; company_name: string }[];
			if (lpId !== undefined) {
				targets = [{ landing_page_id: lpId, keyword: '', company_name: options.company ?? '' }];
			} else {
				const listing = await client.get<{ landing_pages: LandingRes[] }>('landing-pages/', { page: 1, limit: options.limit, company_name: options.company, status: 'success' });
				targets = listing.landing_pages
					.filter((page) => page.status === 'success')
					.map((page) => ({ landing_page_id: page.landing_page_id, keyword: page.keyword ?? '', company_name: options.company! }));
				if (targets.length === 0) {
					err(`No completed landing pages found for '${options.company}'.`);
					throw new Exit(1);
				}
				err(`${targets.length} completed page(s) for ${options.company}:`);
				for (const item of targets) err(`  #${item.landing_page_id} ${item.keyword}`);
			}
			if (options.dryRun) {
				out({ would_rebrand: targets });
				return;
			}
			const rebranded: { msg?: string }[] = [];
			for (const item of targets) {
				const res = await client.post<{ msg?: string }>(`landing-pages/${item.landing_page_id}/rebrand`);
				rebranded.push(res);
				err(`#${item.landing_page_id}: ${res.msg}`);
			}
			out({ rebranded });
		});

	const fixImages = landing
		.command('fix-images')
		.description('Find completed pages whose images fail the CDN gate and queue real image regeneration for each (spends real money per page)')
		.option('--dry-run', 'Only list the pages with placeholder or non CDN images, queue nothing');
	if (!cli.mount) {
		fixImages
			.option('--watch', 'After queueing, poll the audit until it comes back clean')
			.option('--interval <seconds>', 'Seconds between audit polls with --watch', decimal, 30)
			.option('--timeout <seconds>', 'Give up polling after this many seconds with --watch', decimal, 900);
	}
	fixImages.action(async (options: FixOptions) => {
		const client = cli.client();
		const params = { limit: 100 };
		const audit = await client.get<AuditRes>('landing-pages/image-audit', params);
		if (audit.landing_pages.length === 0) {
			err('All completed landing pages pass the image gate. Nothing to fix.');
			out(audit);
			return;
		}
		err(`${audit.landing_pages.length} landing page(s) contain placeholder or non CDN images:`);
		for (const item of audit.landing_pages) err(`  #${item.landing_page_id} [${item.company_name}] ${item.keyword} (${item.image_failures.length} failure(s))`);
		if (options.dryRun) {
			out(audit);
			return;
		}
		const queued: unknown[] = [];
		try {
			for (const item of audit.landing_pages) {
				queued.push(await client.post(`landing-pages/${item.landing_page_id}/regenerate-images`));
				err(`queued image regeneration for #${item.landing_page_id}`);
			}
		} finally {
			cli.billed(queued.length);
		}
		if (!options.watch) {
			out({ queued });
			return;
		}
		out(await auditWatch(client, 'landing-pages/image-audit', params, options, 'failing the image gate'));
	});

	landing
		.command('delete')
		.description('Delete a landing page permanently')
		.argument('<ID>', 'Landing page id', integer)
		.option('--yes', 'Confirm the deletion')
		.action(async (lpId: number, options: { yes?: boolean }) => {
			if (!options.yes) throw new Error('deleting a landing page is permanent, re-run with --yes to confirm');
			out(await cli.client().delete(`landing-pages/${lpId}`));
		});

	landing
		.command('export')
		.description('Export a completed landing page as a copy deck, as HTML, or as its JSON copy deck')
		.argument('<ID>', 'Landing page id', integer)
		.option('--deck', 'Export the copy deck as markdown, the shape that goes into the Google Doc')
		.option(
			'--html',
			'Export the rendered standalone HTML with CDN image URLs (page deliverable only; refused while the page still has placeholder images or placeholder markers in the copy)',
		)
		.option('--copy', 'Export the structured copy deck as JSON')
		.option('--allow-placeholders', 'Export even when the page still contains placeholder images or unresolved placeholder markers')
		.option('--inline', 'Inline every image as a base64 data URI for a fully self contained file')
		.option('-o, --output <path>', 'Write to a file instead of stdout')
		.action(async (lpId: number, options: { deck?: boolean; html?: boolean; copy?: boolean; allowPlaceholders?: boolean; inline?: boolean; output?: string }) => {
			if ([options.deck, options.html, options.copy].filter(Boolean).length !== 1) throw new Error('pass exactly one of --deck, --html or --copy');
			const client = cli.client();
			if (options.deck || options.html) {
				const text = await client.getText(`landing-pages/${lpId}/export`, {
					format: options.deck ? 'deck_md' : 'html',
					allow_placeholders: options.allowPlaceholders ? 'true' : undefined,
					inline: options.inline ? 'true' : undefined,
				});
				writeText(text, options.output, lpId);
				return;
			}
			const page = await client.get<LandingRes>(`landing-pages/${lpId}`);
			if (page.status !== 'success' || !('copy_payload' in page)) throw new Error(`landing page ${lpId} is still ${page.status}, nothing to export yet`);
			writeText(JSON.stringify(page.copy_payload, null, 2), options.output, lpId);
		});

	const reiterate = landing
		.command('reiterate')
		.summary('Check a page against what a buyer needs to see, and fix what a source can carry')
		.description(
			'Check a page against what a buyer needs to see, and fix what a source can carry\n\n' +
				'The second half of the SOP. Ask in a SEPARATE chat, as the customer who typed this keyword and who knows nothing about this company, ' +
				'what would have to be on the page for them to believe it. Pass that answer here and it wins over a generated one.\n\n' +
				'Anything the checklist asks for that no source supports is not written around: it lands in missing_facts as something to get from the client.',
		)
		.argument('<ID>', 'Landing page id', integer)
		.option('--criteria <text>', 'What a buyer told you they need to see, in their words')
		.option('--criteria-file <path>', 'Read that answer from a file')
		.option('--rescore', 'Also pay the reviewer to score the page again afterwards');
	if (!cli.mount) reiterate.option('--watch', 'Follow until the page is saved');
	reiterate.action(async (lpId: number, options: { criteria?: string; criteriaFile?: string; rescore?: boolean; watch?: boolean }) => {
		const text = either(options.criteria, options.criteriaFile, '--criteria or --criteria-file');
		const body: Record<string, unknown> = { rescore: Boolean(options.rescore) };
		if (text) body.criteria_text = text;
		const client = cli.client();
		const res = await client.post<{ criteria_source?: string }>(`landing-pages/${lpId}/re-iterate`, body);
		cli.billed(1);
		err(`Using ${res.criteria_source} criteria. This costs a couple of model calls and one writer pass.`);
		if (!options.watch) {
			out(res);
			return;
		}
		const final = await followPage(client, lpId);
		const report = criteriaOf(final);
		if (report.total) err(`${report.met ?? 0} of ${report.total} criteria met`);
		if (report.research?.added?.length) err(`  found ${report.research.added.length} new source(s) for the writer to cite`);
		for (const gap of report.unmet_unsupported ?? []) err(`  needs the client: ${gap}`);
		out(final);
	});

	landing
		.command('criteria')
		.summary("The buyer's checklist for a page, and setting a line aside")
		.description(
			"The buyer's checklist for a page, and setting a line aside\n\n" +
				"With no option, prints every line with its status. A set aside line stops counting: it leaves the score, the writer's brief, the client asks and the pass decision. " +
				'It never leaves the list. Free, synchronous, no model.',
		)
		.argument('<ID>', 'Landing page id', integer)
		.option('--set-aside <criterion>', 'Set this line aside as not needed (r1, r2, ...)')
		.option('--restore <criterion>', 'Bring a set aside line back')
		.option('--reason <text>', 'Why it is not needed, shown beside the line', '')
		.action(async (lpId: number, options: { setAside?: string; restore?: string; reason: string }) => {
			if (options.setAside && options.restore) throw new Error('pass either --set-aside or --restore, not both');
			const client = cli.client();
			const criterion = options.setAside ?? options.restore;
			if (criterion) {
				const res = await client.patch<{ msg: string; met: number; total: number; eval_status: string | null }>(
					`landing-pages/${lpId}/criteria/${encodeURIComponent(criterion)}`,
					{ dismissed: Boolean(options.setAside), reason: options.reason || null },
				);
				err(`${res.msg}. Now ${res.met} of ${res.total}, page ${res.eval_status}.`);
				out(res);
				return;
			}
			const report = criteriaOf(await client.get<LandingRes>(`landing-pages/${lpId}`));
			if (!report.criteria?.length) throw new Error(`landing page ${lpId} has no buyer checklist yet`);
			const verdicts = new Map((report.coverage ?? []).map((verdict) => [verdict.id, verdict]));
			const aside = new Set(report.dismissed_ids ?? []);
			err(`${report.met ?? 0} of ${report.total ?? 0} met, ${aside.size} set aside`);
			for (const item of report.criteria) {
				const mark = aside.has(item.id) ? 'set aside' : verdicts.get(item.id)?.status || 'missing';
				const flag = item.deal_breaker && mark !== 'met' && mark !== 'set aside' ? ' (they would leave without this)' : '';
				err(`  [${item.id}] ${mark}: ${item.need}${flag}`);
			}
			out(report);
		});

	landing
		.command('versions')
		.description('Every take on this keyword, oldest first')
		.argument('<ID>', 'Landing page id', integer)
		.action(async (lpId: number) => out(await cli.client().get(`landing-pages/${lpId}/versions`)));

	const newVersion = landing
		.command('new-version')
		.summary('Write another version of a page, inheriting everything the first run was given')
		.description(
			'Write another version of a page, inheriting everything the first run was given\n\n' + 'Costs what a normal run costs, because it is one. Send only what should change.',
		)
		.argument('<ID>', 'Landing page id', integer)
		.option('--brief <text>', 'A different angle. Everything else is inherited')
		.option('--brief-file <path>', 'Read the brief from a file')
		.option('--keyword <keyword>', 'A different search phrase')
		.option('--criteria-file <path>', "A buyer's checklist to build to from the start");
	if (!cli.mount) newVersion.option('--watch', 'Follow until the new version is saved');
	newVersion.action(async (lpId: number, options: { brief?: string; briefFile?: string; keyword?: string; criteriaFile?: string; watch?: boolean }) => {
		const brief = either(options.brief, options.briefFile, '--brief or --brief-file');
		const body: Record<string, unknown> = {};
		if (brief) body.page_brief = brief;
		if (options.keyword) body.keyword = options.keyword;
		if (options.criteriaFile) body.reader_criteria = readText(options.criteriaFile);
		const client = cli.client();
		const res = await client.post<{ version: number; landing_page_id: number }>(`landing-pages/${lpId}/versions`, body);
		cli.billed(1);
		err(`Version ${res.version} queued as landing page ${res.landing_page_id}. This spends real money.`);
		out(options.watch ? await followPage(client, res.landing_page_id) : res);
	});

	landing
		.command('deck')
		.summary('The copy deck as markdown, in the house Google Doc template')
		.description(
			'The copy deck as markdown, in the house Google Doc template\n\n' +
				'The same document `export --deck` builds, so what you paste and what you download are the same thing. ' +
				'Paste it into Drive as text/markdown and it becomes a Google Doc.',
		)
		.argument('<ID>', 'Landing page id', integer)
		.option('-o, --output <path>', 'Write it to a file instead of stdout')
		.action(async (lpId: number, options: { output?: string }) => {
			const text = await cli.client().getText(`landing-pages/${lpId}/deck`);
			if (!options.output) {
				line(text);
				return;
			}
			writeFile(options.output, text);
			err(`Wrote ${options.output}`);
		});
}
