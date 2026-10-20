import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Command } from 'commander';
import type { ApiClient } from '../client';
import { configDir, imageJobsPath } from '../config';
import type { Cli } from '../context';
import { readBytes } from '../files';
import { decimal, Exit, fmtNum, integer, watchLoop } from '../helpers';
import { err, isoNow, out } from '../output';
import type { EditFeatImageJobRes } from '../wire';

const FILE_TYPES = ['image', 'csv'];
const MAX_CACHED_JOBS = 50;

export function loadJobCache(): Record<string, EditFeatImageJobRes> {
	try {
		return JSON.parse(readFileSync(imageJobsPath(), 'utf8')) as Record<string, EditFeatImageJobRes>;
	} catch {
		return {};
	}
}

export function cacheJob(key: string, job: EditFeatImageJobRes): void {
	const cache = loadJobCache();
	cache[key] = job;
	const keys = Object.keys(cache);
	for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_CACHED_JOBS))) delete cache[stale];
	mkdirSync(configDir(), { recursive: true, mode: 0o700 });
	writeFileSync(imageJobsPath(), JSON.stringify(cache, null, 2));
}

function keepJob(key: string, job: EditFeatImageJobRes): void {
	try {
		cacheJob(key, job);
	} catch (error) {
		err(`could not keep the job in the local cache (${error instanceof Error ? error.message : String(error)}), the server will not show it again`);
	}
}

export async function fetchStatus(client: ApiClient, articleId: number, jobId: string, cached = true): Promise<EditFeatImageJobRes> {
	const key = `${articleId}:${jobId}`;
	const hit = cached ? loadJobCache()[key] : undefined;
	if (hit) {
		err('served from local cache, the server forgets jobs after the first terminal read');
		return hit;
	}
	const job = await client.get<EditFeatImageJobRes>(`content-writing/article/${articleId}/edit-feat-image/status/${jobId}`);
	if (cached && job.status !== 'pending') keepJob(key, job);
	return job;
}

export function registerImages(program: Command, cli: Cli): void {
	const images = program.command('images').description('Manage featured image edit jobs');

	images
		.command('edit')
		.description('Start a featured image edit job (async, costs real money)')
		.argument('<ARTICLE-ID>', 'Article id', integer)
		.requiredOption('--image-url <url>', 'URL of the image to edit')
		.requiredOption('--instruction <text>', 'Edit instruction')
		.action(async (articleId: number, options: { imageUrl: string; instruction: string }) => {
			const res = await cli.client().post<EditFeatImageJobRes>(`content-writing/article/${articleId}/edit-feat-image`, { image_url: options.imageUrl, instruction: options.instruction });
			cli.billed(1);
			err(`Edit job submitted (costs real money). Poll with ${cli.follow(`images watch ${articleId} ${res.job_id}`, `images status ${articleId} ${res.job_id}`)}, the job expires after 1h`);
			out(res);
		});

	images
		.command('status')
		.description(
			cli.mount
				? 'Check an edit job. The server forgets a finished job after the first read that shows it, so keep what this prints'
				: 'Check an edit job (terminal results are cached locally so re-polls never 404)',
		)
		.argument('<ARTICLE-ID>', 'Article id', integer)
		.argument('<JOB-ID>', 'Edit job id')
		.action(async (articleId: number, jobId: string) => {
			const job = await fetchStatus(cli.client(), articleId, jobId, !cli.mount);
			if (cli.mount && job.status !== 'pending') err('This was the only read of the finished job, the server has now forgotten it, so keep this output');
			out(job);
		});

	if (!cli.mount) {
		images
			.command('watch')
			.description('Poll an edit job until it is done or failed')
			.argument('<ARTICLE-ID>', 'Article id', integer)
			.argument('<JOB-ID>', 'Edit job id')
			.option('--interval <seconds>', 'Seconds between polls', decimal, 3)
			.option('--timeout <seconds>', 'Give up after this many seconds', decimal)
			.action(async (articleId: number, jobId: string, options: { interval: number; timeout?: number }) => {
				const client = cli.client();
				const job = await watchLoop<EditFeatImageJobRes>({
					interval: options.interval,
					timeout: options.timeout,
					poll: () => fetchStatus(client, articleId, jobId),
					progress: (item) => `[${isoNow()}] status=${item.status}`,
					done: (item) => item.status !== 'pending',
					timedOut: () => `timed out after ${fmtNum(options.timeout!)}s, job ${jobId} still pending`,
				});
				out(job);
				if (job.status === 'failed') throw new Exit(1);
			});
	}

	images
		.command('commit')
		.description("Persist an edited image as the article's featured image (arbitrary URLs go through `articles update --feat-image`)")
		.argument('<ARTICLE-ID>', 'Article id', integer)
		.requiredOption('--image-url <url>', 'Image URL from a done edit job in the last 24h')
		.action(async (articleId: number, options: { imageUrl: string }) => {
			out(await cli.client().post(`content-writing/article/${articleId}/commit-feat-image`, { image_url: options.imageUrl }));
		});
}

export function registerUpload(program: Command, cli: Cli): void {
	program
		.command('upload')
		.description('Upload a file to the CDN')
		.argument('<FILE>', 'The file to upload')
		.requiredOption('--type <type>', 'File type: image or csv')
		.action(async (file: string, options: { type: string }) => {
			if (!FILE_TYPES.includes(options.type)) throw new Error(`invalid type '${options.type}', valid values: ${FILE_TYPES.join(', ')}`);
			const content = readBytes(file);
			if (!basename(file).includes('.')) throw new Error('file needs an extension, the CDN key is derived from it');
			out(await cli.client().postForm('upload/', new Blob([content]), basename(file), { file_type: options.type }));
		});
}
