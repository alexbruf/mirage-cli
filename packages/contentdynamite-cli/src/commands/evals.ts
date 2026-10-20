import type { Command } from 'commander';
import type { Params } from '../client';
import type { Cli } from '../context';
import { decimal, Exit, integer } from '../helpers';
import { err, line, out } from '../output';
import type { ArticleQaRes, QaAuditRes } from '../wire';

const DEFAULT_THRESHOLD = 7.0;
const ORIGIN_ORDER = ['copy', 'inputs', 'age', 'blocked'];

type Summary = Partial<Extract<QaAuditRes['summary'], { mean: number }>> & { count: number };
type Part = ArticleQaRes['report']['content']['compliance'];

interface RunOptions {
	all?: boolean;
	company?: string;
	images: boolean;
	judge?: boolean;
	store?: boolean;
	threshold: number;
	limit: number;
	json?: boolean;
}

const articleIds = (value: string, previous: number[] = []) => [...previous, integer(value)];

function originLine(lost: Record<string, number>): string {
	const origins = Object.keys(lost);
	if (origins.length === 0) return 'nothing lost';
	const ordered = [...ORIGIN_ORDER.filter((origin) => origin in lost), ...origins.filter((origin) => !ORIGIN_ORDER.includes(origin))];
	return ordered.map((origin) => `${origin} ${lost[origin]}`).join(', ');
}

function exitOn(rows: readonly { score: number | null }[], threshold: number): void {
	const low = rows.filter((row) => row.score !== null && row.score < threshold);
	if (low.length === 0) return;
	err(`${low.length} article(s) below ${threshold}`);
	throw new Exit(1);
}

function printAudit(res: QaAuditRes): void {
	const summary = res.summary as Summary;
	line(
		`${summary.count} article(s) of ${res.total_success} shipped  mean ${summary.mean ?? null}  range ${summary.min ?? null} to ${summary.max ?? null}` +
			`  ${summary.below_threshold ?? 0} below ${summary.threshold ?? null}`,
	);
	line(`points lost by origin: ${originLine(summary.points_lost_by_origin ?? {})}`);
	line(`compliance mean counting COPY faults only: ${summary.mean_compliance_excluding_non_copy ?? null}`);
	line('');
	line(`${'score'.padStart(7)} ${'content'.padStart(8)} ${'image'.padStart(7)}  article`);
	for (const row of res.articles) {
		line(`${String(row.score).padStart(7)} ${String(row.content_score).padStart(8)} ${String(row.image_score ?? '-').padStart(7)}  #${String(row.article_id).padEnd(5)} ${row.title.slice(0, 46)}`);
		if (Object.keys(row.lost_by_origin).length > 0) line(`${''.padStart(24)}  lost: ${originLine(row.lost_by_origin)}`);
	}
}

function printPart(name: string, part: Part): void {
	line(`  ${name}  ${part.score}/${part.budget}${part.trusted === false ? '   (reported, NOT counted in the score)' : ''}`);
	for (const deduction of part.deductions) {
		line(`    -${String(deduction.points).padEnd(5)} ${deduction.origin.padEnd(7)} ${deduction.code.padEnd(33)} ${deduction.message}`);
		if (deduction.evidence) line(`           evidence: ${deduction.evidence.slice(0, 110)}`);
	}
	for (const skipped of part.skipped) line(`    skipped: ${skipped}`);
}

function printReport(articleId: number, res: ArticleQaRes): void {
	const { content, image } = res.report;
	const blended = content.score_with_model ?? content.score;
	const contentColumn = blended !== content.score ? `content ${blended} (code ${content.score})` : `content ${content.score}`;
	line('');
	line(`#${articleId}  SCORE ${res.score}   ${contentColumn}   image ${image?.scaled_score ?? '-'}${res.stored ? '   [stored]' : ''}`);
	const verdict = content.judge;
	if (verdict) {
		line(`  judge  ${verdict.total}/${verdict.ceiling} -> ${verdict.score}/10   ${verdict.verdict.toUpperCase()}   (${verdict.model})`);
		for (const [dimension, score] of Object.entries(verdict.scores)) line(`    ${String(score).padStart(2)}/10  ${dimension}`);
		for (const violation of verdict.violations.slice(0, 5)) line(`    ! ${violation.slice(0, 140)}`);
		for (const fix of verdict.top_fixes) line(`    fix: ${fix.slice(0, 130)}`);
	} else if (content.judge_error) {
		err(`  judge did not run: ${content.judge_error}`);
	}
	printPart('compliance', content.compliance);
	printPart('craft', content.craft);
	if (image) printPart('image', image);
}

export function registerEvals(program: Command, cli: Cli): void {
	const evals = program.command('evals').description('Score finished articles against the deterministic quality checks');

	evals
		.command('run')
		.description('Score one or more articles. Free: no model is called.')
		.argument('[ID...]', 'Article ids. Omit with --all.', articleIds)
		.option('--all', 'Score every shipped article')
		.option('--company <name>', "Only this company's articles (with --all)")
		.option('--no-images', 'Skip the per image fetch')
		.option('--judge', 'Also run the model judge. Costs a model call per article.')
		.option('--store', 'Keep the result on article.qa_report (the default)')
		.option('--no-store', 'Score without keeping the result')
		.option('--threshold <score>', 'Exit 1 if any article scores below this', decimal, DEFAULT_THRESHOLD)
		.option('--limit <limit>', 'Page size for --all', integer, 200)
		.option('--json', 'Emit the full report instead of a summary')
		.action(async (ids: number[] | undefined, options: RunOptions) => {
			const articles = ids ?? [];
			if (options.all && articles.length > 0) throw new Error('pass article ids or --all, not both');
			if (!options.all && articles.length === 0) throw new Error('pass at least one article id, or --all');
			if (options.company && !options.all) throw new Error('--company only applies with --all');
			const client = cli.client();
			err(`scoring against ${cli.baseUrl()}`);

			if (options.all) {
				const params: Params = { limit: options.limit, images: options.images ? 'true' : 'false', company_name: options.company };
				const res = await client.get<QaAuditRes>('content-writing/articles/qa-audit', params);
				if (options.json) out(res);
				else printAudit(res);
				exitOn(res.articles, options.threshold);
				return;
			}

			const rows: { article_id: number; score: number; report: ArticleQaRes['report'] }[] = [];
			try {
				for (const articleId of articles) {
					const res = await client.post<ArticleQaRes>(`content-writing/article/${articleId}/qa`, undefined, {
						model_checks: options.judge ? 'true' : 'false',
						store: options.store === false ? 'false' : 'true',
					});
					rows.push({ article_id: articleId, score: res.score, report: res.report });
					if (!options.json) printReport(articleId, res);
				}
			} finally {
				cli.billed(rows.filter((row) => row.report.content.judge).length);
			}
			if (options.json) out(rows);
			exitOn(rows, options.threshold);
		});
}
