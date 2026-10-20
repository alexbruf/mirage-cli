import { Option, type Command } from 'commander';
import type { Cli } from '../context';
import { decimal, either, Exit, fmtNum, integer, watchLoop } from '../helpers';
import { err, isoNow, out } from '../output';
import { REVISION_PARTS, REVISION_STATUSES, REVISION_TARGETS, REVISION_VERDICTS, type RevisionDetailRes, type RevisionRes, type VerdictRes } from '../wire';

interface RejectOptions {
	part: string;
	index?: number;
	target?: string;
	text?: string;
	textFile?: string;
	reason?: string;
	reasonFile?: string;
}

interface ListOptions {
	part?: string;
	target?: string;
	status?: string;
	verdict?: string;
	profileId?: number;
	page: number;
	limit: number;
}

const REJECT_HELP = [
	'Reject one part of a finished article because a writer called it bad, and have it made again. Asynchronous and spends real money: the writer model, plus fal for an image or the renderer for a video.',
	'--index is required for a section or an image, optional for the FAQ and ignored otherwise. `ve-dynamite articles parts <id>` lists the indexes.',
	"For a section, --target picks what to remake: section (the default, the whole section), heading (only the ## line, the text under it stays) or passage (only --text, which must be copied character for character from the article's body markdown, appear once in that section and hold whole links and images).",
	'For the intro, leave --target out to remake all of it, or use passage with --text copied the same way from the intro.',
	"For the FAQ, leave --index out to remake all of it. With an item's index, --target picks answer (the default, the question stays), question (only the question) or passage (--text copied from that item's answer in the FAQ HTML, holding whole tags).",
	"--reason is the writer's own words about what is wrong. It briefs the rebuild, so pass it verbatim. The article is not changed: the replacement waits beside the refused part until a verdict.",
].join('\n\n');

const VERDICT_HELP = [
	"Record the writer's verdict on a ready revision: better, same or worse.",
	'Pass only what the writer said: the verdict is the record of what a person calls bad. better puts the replacement into the article, unless the article changed since the rejection (applied comes back false). same and worse keep the original. One verdict per revision; to try again, reject the part again.',
].join('\n\n');

export function registerArticleRevisions(articles: Command, cli: Cli): void {
	articles
		.command('parts')
		.description('List the parts of a finished article a writer can reject, with the indexes reject takes')
		.argument('<ID>', 'Article id', integer)
		.action(async (articleId: number) => out(await cli.client().get(`content-writing/article/${articleId}/parts`)));

	articles
		.command('reject')
		.summary('Reject one part of a finished article and have it remade (async, spends real money)')
		.description(REJECT_HELP)
		.argument('<ID>', 'Article id', integer)
		.addOption(new Option('--part <part>', 'The part the writer called bad').choices(REVISION_PARTS).makeOptionMandatory())
		.option('--index <n>', 'Which section, image or FAQ item, counting from 0', integer)
		.addOption(new Option('--target <target>', 'What to remake inside a section, the intro or an FAQ item').choices(REVISION_TARGETS))
		.option('--text <passage>', 'With --target passage: the passage, copied character for character')
		.option('--text-file <path>', 'Read the passage from a file')
		.option('--reason <text>', "The writer's own words about what is wrong")
		.option('--reason-file <path>', 'Read the reason from a file')
		.action(async (articleId: number, options: RejectOptions) => {
			const text = either(options.text, options.textFile, '--text or --text-file');
			const reason = either(options.reason, options.reasonFile, '--reason or --reason-file');
			const body: Record<string, unknown> = { part: options.part };
			if (options.index !== undefined) body.index = options.index;
			if (options.target) body.target = options.target;
			if (text) body.text = text;
			if (reason) body.reason = reason;
			const revision = await cli.client().post<RevisionRes>(`content-writing/article/${articleId}/revisions`, body);
			cli.billed(1);
			err(
				`The ${options.part} is being remade, which spends real money. The article stays as it is until a verdict. ` +
					`Poll with ${cli.follow(`revisions watch ${articleId} ${revision.revision_id}`, `revisions get ${articleId} ${revision.revision_id}`)}`,
			);
			out(revision);
		});

	articles
		.command('revisions')
		.description('Every revision of one article, newest first')
		.argument('<ID>', 'Article id', integer)
		.action(async (articleId: number) => out(await cli.client().get(`content-writing/article/${articleId}/revisions`)));
}

export function registerRevisions(program: Command, cli: Cli): void {
	const revisions = program.command('revisions').description('Parts of articles writers rejected, the replacements and the verdicts');

	revisions
		.command('list')
		.summary('List every revision you can see, newest first')
		.description("Every revision you can see, newest first: what writers rejected and whether the replacement was better. An admin sees every account's")
		.addOption(new Option('--part <part>', 'Only this part').choices(REVISION_PARTS))
		.addOption(new Option('--target <target>', 'Only this target').choices(REVISION_TARGETS))
		.addOption(new Option('--status <status>', 'Only this status').choices(REVISION_STATUSES))
		.addOption(new Option('--verdict <verdict>', 'Only this verdict').choices(REVISION_VERDICTS))
		.option('--profile-id <id>', "Only revisions of this company profile's articles", integer)
		.option('--page <page>', 'Page number', integer, 1)
		.option('--limit <limit>', 'Page size (max 100)', integer, 20)
		.action(async (options: ListOptions) => {
			const { page, limit, part, target, status, verdict } = options;
			out(await cli.client().get('content-writing/revisions', { page, limit, part, target, status, verdict, company_profile_id: options.profileId }));
		});

	revisions
		.command('get')
		.summary('Show one revision: both versions, their scores and the verdict')
		.description("One revision: the refused part, the replacement once it is ready, the article's score with each, both score reports and the verdict")
		.argument('<ARTICLE-ID>', 'Article id', integer)
		.argument('<REVISION-ID>', 'Revision id', integer)
		.action(async (articleId: number, revisionId: number) => out(await cli.client().get(`content-writing/article/${articleId}/revisions/${revisionId}`)));

	if (!cli.mount) {
		revisions
			.command('watch')
			.description('Poll a revision until the replacement is ready or the remake failed')
			.argument('<ARTICLE-ID>', 'Article id', integer)
			.argument('<REVISION-ID>', 'Revision id', integer)
			.option('--interval <seconds>', 'Seconds between polls', decimal, 10)
			.option('--timeout <seconds>', 'Give up after this many seconds', decimal)
			.action(async (articleId: number, revisionId: number, options: { interval: number; timeout?: number }) => {
				const client = cli.client();
				const revision = await watchLoop<RevisionDetailRes>({
					interval: options.interval,
					timeout: options.timeout,
					poll: () => client.get(`content-writing/article/${articleId}/revisions/${revisionId}`),
					progress: (item) => `[${isoNow()}] status=${item.status}`,
					done: (item) => item.status !== 'pending',
					timedOut: (item) => `timed out after ${fmtNum(options.timeout!)}s, revision ${revisionId} still ${item.status}`,
				});
				out(revision);
				if (revision.status === 'failed') throw new Exit(1);
			});
	}

	revisions
		.command('verdict')
		.summary("Record the writer's verdict on a ready revision: better, same or worse")
		.description(VERDICT_HELP)
		.argument('<ARTICLE-ID>', 'Article id', integer)
		.argument('<REVISION-ID>', 'Revision id', integer)
		.addOption(new Option('--verdict <verdict>', "The writer's verdict").choices(REVISION_VERDICTS).makeOptionMandatory())
		.option('--note <text>', "The writer's note on the verdict")
		.option('--note-file <path>', 'Read the note from a file')
		.action(async (articleId: number, revisionId: number, options: { verdict: string; note?: string; noteFile?: string }) => {
			const note = either(options.note, options.noteFile, '--note or --note-file');
			const res = await cli.client().post<VerdictRes>(`content-writing/article/${articleId}/revisions/${revisionId}/verdict`, { verdict: options.verdict, note: note ?? null });
			err(res.msg);
			out(res);
		});
}
