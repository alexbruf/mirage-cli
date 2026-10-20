import { basename } from 'node:path';
import type { Command } from 'commander';
import type { ApiClient, Params } from '../client';
import type { Cli } from '../context';
import { readText } from '../files';
import { decimal, Exit, fmtNum, integer, interactiveFields, watchLoop } from '../helpers';
import { parseJobs, readJobs } from '../jobs';
import { err, isoNow, out } from '../output';
import { articleJobsToCsv, batchArticleJob, INTERACTIVE_TYPES, readCsvTable, type BatchRes, type BatchWriteRes } from '../wire';
import { everyArticle } from './articles';

const GUIDELINE_HINT = 'the batch wide --guidelines / --image-guideline flags';
const TRUTHY = ['true', '1', 'yes'];

interface CreateOptions {
	name: string;
	csv?: string;
	jobs?: string;
	guidelines?: string;
	imageGuideline?: string;
	infographic?: boolean;
	video?: boolean;
	interactive?: string | boolean;
	dewatermark?: boolean;
}

async function findBatch(client: ApiClient, batchId: number): Promise<BatchRes> {
	const batch = (await client.get<BatchRes[]>('content-writing/batches')).find((item) => item.batch_id === batchId);
	if (!batch) throw new Error(`batch ${batchId} not found, run \`ve-dynamite batches list\``);
	return batch;
}

async function jobsCsv(options: CreateOptions): Promise<{ csv: string; filename: string }> {
	if (Boolean(options.csv) === Boolean(options.jobs)) throw new Error('pass exactly one of --csv or --jobs');
	if (options.csv) return { csv: readText(options.csv), filename: options.csv.endsWith('.csv') ? basename(options.csv) : 'batch.csv' };
	const jobs = parseJobs(readJobs(options.jobs!), batchArticleJob);
	return { csv: await articleJobsToCsv(jobs, GUIDELINE_HINT).text(), filename: 'batch.csv' };
}

const gbpPostsAsked = (csv: string) => readCsvTable(csv).rows.filter((row) => TRUTHY.includes((row.get('gbp_post') ?? '').trim().toLowerCase())).length;

function batchParams(options: CreateOptions): Params {
	const params: Params = { batch_name: options.name };
	if (options.guidelines) params.extra_guidelines = options.guidelines;
	if (options.imageGuideline) params.image_guideline = options.imageGuideline;
	if (options.infographic) params.infographic_feat_image = true;
	if (options.video) params.generate_video = true;
	Object.assign(params, interactiveFields(options.interactive));
	if (options.dewatermark !== undefined) {
		params.dewatermark = options.dewatermark;
		if (options.dewatermark) err("--dewatermark adds one rewrite call PER ARTICLE and trades some of Claude's voice for hygiene.");
	}
	return params;
}

export function registerBatches(program: Command, cli: Cli): void {
	const batches = program.command('batches').description('Manage article batches');

	batches
		.command('create')
		.description('Queue a batch of articles (async, costs real money PER ARTICLE)')
		.requiredOption('--name <name>', 'Batch name (unique per user)')
		.option('--csv <path>', 'CSV file of jobs')
		.option('--jobs <path>', 'JSON file with an array of job objects')
		.option('--guidelines <text>', 'Batch wide extra writing guidelines')
		.option('--image-guideline <text>', 'Batch wide featured image guideline')
		.option('--infographic', 'Batch wide infographic featured images')
		.option('--video', 'Batch wide companion videos')
		.option('--interactive [type]', `Batch wide interactive components, optionally ${INTERACTIVE_TYPES.join('|')}`)
		.option('--dewatermark', 'Batch wide prose rewrite through a non-Claude model. Omit to follow DEWATERMARK_REWRITE_ENABLED. A per row dewatermark column still wins')
		.option('--no-dewatermark', 'Batch wide: keep the prose as written. A per row dewatermark column still wins')
		.action(async (options: CreateOptions) => {
			const { csv, filename } = await jobsCsv(options);
			const params = batchParams(options);
			const res = await cli.client().postForm<BatchWriteRes>('content-writing/articles/batch', new Blob([csv], { type: 'text/csv' }), filename, params);
			cli.billed(res.total + gbpPostsAsked(csv));
			err(`Queued ${res.total} articles, each spends real money (LLM, SERP, crawling, images). Poll with ${cli.follow(`batches watch ${res.batch_id}`, `batches get ${res.batch_id}`)}`);
			out(res);
		});

	batches
		.command('list')
		.description('List your batches with progress counters')
		.action(async () => out(await cli.client().get('content-writing/batches')));

	batches
		.command('get')
		.description('Show one batch with its member articles')
		.argument('<ID>', 'Batch id', integer)
		.action(async (batchId: number) => {
			const client = cli.client();
			const batch = await findBatch(client, batchId);
			out({ ...batch, articles: await everyArticle(client, { batch_id: batchId }) });
		});

	if (!cli.mount) {
		batches
			.command('watch')
			.description('Poll a batch until every article is completed or failed')
			.argument('<ID>', 'Batch id', integer)
			.option('--interval <seconds>', 'Seconds between polls', decimal, 10)
			.option('--timeout <seconds>', 'Give up after this many seconds', decimal)
			.action(async (batchId: number, options: { interval: number; timeout?: number }) => {
				const client = cli.client();
				const settled = (batch: BatchRes) => batch.completed_articles + batch.failed_articles;
				const batch = await watchLoop<BatchRes>({
					interval: options.interval,
					timeout: options.timeout,
					poll: () => findBatch(client, batchId),
					progress: (item) => `[${isoNow()}] completed=${item.completed_articles} failed=${item.failed_articles} total=${item.total_articles}`,
					done: (item) => settled(item) >= item.total_articles,
					timedOut: (item) => `timed out after ${fmtNum(options.timeout!)}s, batch ${batchId} at ${settled(item)}/${item.total_articles}`,
				});
				out(batch);
				if (batch.failed_articles > 0) throw new Exit(1);
			});
	}

	batches
		.command('delete')
		.description('Delete a batch permanently')
		.argument('<ID>', 'Batch id', integer)
		.option('--yes', 'Confirm the deletion')
		.action(async (batchId: number, options: { yes?: boolean }) => {
			if (!options.yes) throw new Error('deleting a batch is permanent, re-run with --yes to confirm');
			out(await cli.client().delete(`content-writing/batch/${batchId}`));
		});
}
