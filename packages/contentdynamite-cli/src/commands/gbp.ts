import { basename } from 'node:path';
import type { Command } from 'commander';
import type { Params } from '../client';
import type { Cli } from '../context';
import { readText } from '../files';
import { decimal, either, Exit, fmtNum, integer, watchLoop } from '../helpers';
import { parseJobs, readJobs } from '../jobs';
import { err, isoNow, out } from '../output';
import { batchGbpJob, gbpJobsToCsv, wireGbpSource, wireGbpStatus, type BatchGbpPostsRes, type GbpPostRes, type WriteGbpPostRes } from '../wire';

interface WriteOptions {
	profileId: number;
	topic?: string;
	articleId?: number;
	location?: string;
	facts?: string;
	factsFile?: string;
	guidelines?: string;
	image?: string;
	imageUrl?: string;
	imageGuideline?: string;
	regenerate?: boolean;
}

interface BatchOptions {
	csv?: string;
	jobs?: string;
	location?: string;
	facts?: string;
	factsFile?: string;
	guidelines?: string;
	image?: string;
	imageGuideline?: string;
}

interface UpdateOptions {
	content?: string;
	contentFile?: string;
	imageUrl?: string;
	topic?: string;
	status?: string;
}

const isTerminal = (post: GbpPostRes) => post.status === 'done' || post.status === 'failed';

function writeBody(options: WriteOptions): Record<string, unknown> {
	const facts = either(options.facts, options.factsFile, '--facts or --facts-file');
	const body: Record<string, unknown> = { company_profile_id: options.profileId };
	if (options.topic) body.topic = options.topic;
	if (options.articleId !== undefined) body.article_id = options.articleId;
	if (options.location) body.location = options.location;
	if (facts) body.facts = facts;
	if (options.guidelines) body.guidelines = options.guidelines;
	if (options.image) body.image_mode = options.image;
	if (options.imageUrl) body.image_url = options.imageUrl;
	if (options.imageGuideline) body.image_guideline = options.imageGuideline;
	if (options.regenerate) body.regenerate = true;
	return body;
}

async function postsCsv(options: BatchOptions): Promise<{ csv: string; filename: string }> {
	if (Boolean(options.csv) === Boolean(options.jobs)) throw new Error('pass exactly one of --csv or --jobs');
	if (options.csv) return { csv: readText(options.csv), filename: options.csv.endsWith('.csv') ? basename(options.csv) : 'gbp.csv' };
	return { csv: await gbpJobsToCsv(parseJobs(readJobs(options.jobs!), batchGbpJob)).text(), filename: 'gbp.csv' };
}

function batchParams(options: BatchOptions): Params {
	const facts = either(options.facts, options.factsFile, '--facts or --facts-file');
	const params: Params = {};
	if (options.location) params.location = options.location;
	if (facts) params.facts = facts;
	if (options.guidelines) params.guidelines = options.guidelines;
	if (options.image) params.image_mode = options.image;
	if (options.imageGuideline) params.image_guideline = options.imageGuideline;
	return params;
}

function updateBody(options: UpdateOptions): Record<string, string> {
	const content = either(options.content, options.contentFile, '--content or --content-file');
	const body: Record<string, string> = {};
	if (content) body.content = content;
	if (options.imageUrl) body.image_url = options.imageUrl;
	if (options.topic) body.topic = options.topic;
	if (options.status) body.status = wireGbpStatus(options.status)!;
	if (Object.keys(body).length === 0) throw new Error('nothing to update');
	return body;
}

export function registerGbp(program: Command, cli: Cli): void {
	const gbp = program.command('gbp').description('Manage Google Business Profile posts');

	gbp
		.command('write')
		.description('Queue one GBP post (async, spends an LLM call and, unless --image none, an image credit)')
		.requiredOption('--profile-id <id>', 'Company profile id', integer)
		.option('--topic <topic>', 'What the post is about. Required unless --article-id is given')
		.option('--article-id <id>', 'Repurpose this finished article instead of writing from a topic', integer)
		.option('--location <location>', 'Service area to frame the post around')
		.option('--facts <text>', 'The only specifics the post may state about this company')
		.option('--facts-file <path>', 'Read the facts from a file')
		.option('--guidelines <text>', 'A one off instruction for this post')
		.option('--image <mode>', 'none | supplied | article | generate. Defaults to article when repurposing and generate otherwise')
		.option('--image-url <url>', 'The picture to use. Upload one with `ve-dynamite upload`, or take one from `ve-dynamite gbp image-options`')
		.option('--image-guideline <text>', 'Style guidance, for a generated image only')
		.option('--regenerate', 'Overwrite the post this article already has')
		.action(async (options: WriteOptions) => {
			const res = await cli.client().post<WriteGbpPostRes>('gbp-posts/', writeBody(options));
			cli.billed(1);
			err(`Poll with ${cli.follow(`gbp watch ${res.gbp_post_id}`, `gbp get ${res.gbp_post_id}`)}`);
			out(res);
		});

	gbp
		.command('batch')
		.description('Queue a list of GBP posts (async, spends real money PER POST)')
		.option(
			'--csv <path>',
			'CSV file of posts (columns: company_profile_id, topic, article_id, location, facts, guidelines, image_mode, image_url, image_guideline, regenerate)',
		)
		.option('--jobs <path>', 'JSON file with an array of post objects')
		.option('--location <location>', 'Batch wide service area')
		.option('--facts <text>', 'Batch wide brand facts')
		.option('--facts-file <path>', 'Read the batch wide facts from a file')
		.option('--guidelines <text>', 'Batch wide writing instruction')
		.option('--image <mode>', 'Batch wide image mode: none | supplied | article | generate')
		.option('--image-guideline <text>', 'Batch wide image style guidance')
		.action(async (options: BatchOptions) => {
			const { csv, filename } = await postsCsv(options);
			const params = batchParams(options);
			const res = await cli.client().postForm<BatchGbpPostsRes>('gbp-posts/batch', new Blob([csv], { type: 'text/csv' }), filename, params);
			cli.billed(res.total);
			err(`Queued ${res.total} GBP posts, each spends real money. Poll with \`ve-dynamite gbp list\``);
			out(res);
		});

	gbp
		.command('get')
		.description('Show one GBP post')
		.argument('<ID>', 'GBP post id', integer)
		.action(async (postId: number) => out(await cli.client().get(`gbp-posts/${postId}`)));

	gbp
		.command('list')
		.description('List GBP posts, newest first')
		.option('--page <page>', 'Page number', integer, 1)
		.option('--limit <limit>', 'Page size (max 100)', integer, 10)
		.option('--company <name>', 'Filter by exact company name')
		.option('--status <status>', 'Filter by status: pending, done, failed')
		.option('--source <source>', 'Filter by where the post came from: article or topic')
		.action(async (options: { page: number; limit: number; company?: string; status?: string; source?: string }) => {
			const filter = { status: wireGbpStatus(options.status), source: wireGbpSource(options.source) };
			out(await cli.client().get('gbp-posts/', { page: options.page, limit: options.limit, company_name: options.company, ...filter }));
		});

	if (!cli.mount) {
		gbp
			.command('watch')
			.description('Poll a GBP post until it is written (done or failed)')
			.argument('<ID>', 'GBP post id', integer)
			.option('--interval <seconds>', 'Seconds between polls', decimal, 5)
			.option('--timeout <seconds>', 'Give up after this many seconds', decimal)
			.action(async (postId: number, options: { interval: number; timeout?: number }) => {
				const client = cli.client();
				const post = await watchLoop<GbpPostRes>({
					interval: options.interval,
					timeout: options.timeout,
					poll: () => client.get(`gbp-posts/${postId}`),
					progress: (item) => `[${isoNow()}] status=${item.status} image=${item.image_url ? 'yes' : 'no'}`,
					done: isTerminal,
					timedOut: (item) => `timed out after ${fmtNum(options.timeout!)}s, GBP post ${postId} still ${item.status}`,
				});
				out(post);
				if (post.status === 'failed') throw new Exit(1);
			});
	}

	gbp
		.command('image-options')
		.description('Images this client already has, any of which can be passed to --image-url')
		.requiredOption('--profile-id <id>', 'Company profile id', integer)
		.action(async (options: { profileId: number }) => out(await cli.client().get('gbp-posts/image-options', { company_profile_id: options.profileId })));

	gbp
		.command('update')
		.description('Edit a written GBP post by hand before it goes live')
		.argument('<ID>', 'GBP post id', integer)
		.option('--content <text>', 'Replace the post text')
		.option('--content-file <path>', 'Read the replacement text from a file')
		.option('--image-url <url>', 'Replace the image')
		.option('--topic <topic>', 'Correct the recorded topic')
		.option('--status <status>', 'Set the status: pending, done, failed')
		.action(async (postId: number, options: UpdateOptions) => out(await cli.client().put(`gbp-posts/${postId}`, updateBody(options))));

	gbp
		.command('regenerate')
		.description('Write an existing GBP post again, on the request it already carries')
		.argument('<ID>', 'GBP post id', integer)
		.action(async (postId: number) => {
			const res = await cli.client().post(`gbp-posts/${postId}/regenerate`);
			cli.billed(1);
			err(`Poll with ${cli.follow(`gbp watch ${postId}`, `gbp get ${postId}`)}`);
			out(res);
		});

	gbp
		.command('delete')
		.description('Delete a GBP post permanently')
		.argument('<ID>', 'GBP post id', integer)
		.option('--yes', 'Confirm the deletion')
		.action(async (postId: number, options: { yes?: boolean }) => {
			if (!options.yes) throw new Error('deleting a GBP post is permanent, re-run with --yes to confirm');
			out(await cli.client().delete(`gbp-posts/${postId}`));
		});
}
