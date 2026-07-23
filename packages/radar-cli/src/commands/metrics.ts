/**
 * `radar metrics *` + `radar export-results` — server-side aggregates and
 * bulk export over /api/v1/metrics + /api/v1/export-full, which remount the
 * Radar dashboard's own metrics/export routers, so every number here is
 * identical to the app's Overview.
 *
 * Ported from the prod `ve-radar` CLI (prod-ai-visibility-tool
 * `cli/commands/metrics.ts`) — keep the two in lockstep; only the client
 * call sites differ (this client exposes request/requestRaw with `/v1/...`
 * paths).
 */
import type { Command } from "commander";
import type { ApiClient } from "../client.ts";
import { type FlatRow, parseFormat, printRows } from "../format.ts";

type GetClient = () => Promise<ApiClient>;

interface WindowOpts {
  days?: string;
  from?: string;
  until?: string;
  platforms?: string;
  format?: string;
}

const DAY_MS = 86_400_000;

function windowParams(opts: WindowOpts): Record<string, string | undefined> {
  return { days: opts.days, from: opts.from, until: opts.until, platforms: opts.platforms };
}

/**
 * The equal-length window immediately before the current one (period-over-
 * period). Mirrors the server's resolveDateWindow math exactly
 * (src/lib/projectSnapshot.ts): date-only --until means "through the end of
 * that day", custom spans clamp to the 730-day max, invalid dates fall back
 * to the --days preset instead of producing NaN windows.
 */
function priorWindow(opts: WindowOpts): { from: string; until: string } {
  if (opts.from) {
    const untilDateOnly = !!opts.until && /^\d{4}-\d{2}-\d{2}$/.test(opts.until);
    const untilMs = opts.until ? Date.parse(opts.until) + (untilDateOnly ? DAY_MS : 0) : Date.now();
    const rawFromMs = Date.parse(opts.from);
    const fromMs = Number.isFinite(rawFromMs)
      ? Math.max(rawFromMs, untilMs - 730 * DAY_MS)
      : rawFromMs;
    if (Number.isFinite(fromMs) && Number.isFinite(untilMs) && untilMs > fromMs) {
      const span = untilMs - fromMs;
      return { from: new Date(fromMs - span).toISOString(), until: new Date(fromMs).toISOString() };
    }
    console.error("Invalid --from/--until window; falling back to the --days preset.");
  }
  // parseRangeDays parity: invalid → 28, floor 1, cap 730.
  const parsed = Number.parseInt(opts.days ?? "", 10);
  const days = Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, 730) : 28;
  const now = Date.now();
  return {
    from: new Date(now - 2 * days * DAY_MS).toISOString(),
    until: new Date(now - days * DAY_MS).toISOString(),
  };
}

function addWindowOptions(cmd: Command, defaultFormat: string): Command {
  return cmd
    .requiredOption("--project <id>", "Project id")
    .option("--days <n>", "Window: last N days (default 28, max 730)")
    .option("--from <date>", "Window start (ISO date; overrides --days)")
    .option("--until <date>", "Window end (ISO date; default now)")
    .option("--platforms <list>", "Comma-separated platform filter (e.g. chatgpt_api,gemini)")
    .option("--format <fmt>", `Output: json|table|csv (default ${defaultFormat})`);
}

interface OverviewResponse {
  headline: {
    mentionSov: number;
    citationSov: number;
    avgRank: number | null;
    overallScore: number | null;
  };
  rankBuckets: Record<string, number>;
}

export function registerMetricsCommands(program: Command, getClient: GetClient): void {
  const metrics = program
    .command("metrics")
    .description("Server-side aggregates — the same numbers as the dashboard Overview");

  addWindowOptions(
    metrics
      .command("overview")
      .description("Headline metrics: mention SoV, citation SoV, avg rank, visibility score"),
    "table",
  )
    .option("--compare", "Also fetch the previous equal-length period and show deltas")
    .action(async (opts: WindowOpts & { project: string; compare?: boolean }) => {
      const client = await getClient();
      const path = `/v1/metrics/overview/${opts.project}`;
      const current = await client.request<OverviewResponse>(path, {
        query: windowParams(opts),
      });
      const metricRows = (r: OverviewResponse): FlatRow[] => [
        { metric: "mentionSov", value: r.headline.mentionSov },
        { metric: "citationSov", value: r.headline.citationSov },
        { metric: "avgRank", value: r.headline.avgRank },
        { metric: "overallScore", value: r.headline.overallScore },
        ...Object.entries(r.rankBuckets ?? {}).map(([k, v]) => ({ metric: `rank.${k}`, value: v })),
      ];
      if (!opts.compare) {
        printRows(current, metricRows(current), parseFormat(opts.format, "table"));
        return;
      }
      const prior = priorWindow(opts);
      const previous = await client.request<OverviewResponse>(path, {
        query: { from: prior.from, until: prior.until, platforms: opts.platforms },
      });
      const prevByMetric = new Map(metricRows(previous).map((r) => [r.metric, r.value]));
      const rows = metricRows(current).map((r) => {
        const prev = prevByMetric.get(r.metric);
        const change =
          typeof r.value === "number" && typeof prev === "number"
            ? Math.round((r.value - prev) * 10) / 10
            : null;
        return { ...r, previous: prev ?? null, change };
      });
      printRows({ current, previous, priorWindow: prior }, rows, parseFormat(opts.format, "table"));
    });

  addWindowOptions(
    metrics
      .command("project")
      .description("Per-query scores + per-model and per-category breakdowns"),
    "table",
  ).action(async (opts: WindowOpts & { project: string }) => {
    const client = await getClient();
    const data = await client.request<{
      queries: FlatRow[];
      modelScores: FlatRow[];
      categoryScores: FlatRow[];
      overallScore: number | null;
      overallScoreDelta: number | null;
    }>(`/v1/metrics/project/${opts.project}`, {
      query: { ...windowParams(opts), view: "overview" },
    });
    const rows = (data.queries ?? []).map((q) => ({
      query: typeof q.query_text === "string" ? q.query_text.slice(0, 60) : q.id,
      category: q.category,
      avgScore: q.avgScore,
      delta: q.avgScoreDelta,
      brandRank: q.brandRank,
    }));
    printRows(data, rows, parseFormat(opts.format, "table"));
  });

  addWindowOptions(
    metrics.command("brands").description("Competitor mention share of voice (Brands table)"),
    "table",
  ).action(async (opts: WindowOpts & { project: string }) => {
    const client = await getClient();
    const data = await client.request<{ brands: FlatRow[]; totalMentions: number }>(
      "/v1/metrics/brands",
      { query: { projectId: opts.project, ...windowParams(opts) } },
    );
    const rows = (data.brands ?? []).map((b) => ({ ...b, isYou: b.isYou ? "you" : "" }));
    printRows(data, rows, parseFormat(opts.format, "table"), [
      "rank",
      "name",
      "mentions",
      "visibility",
      "isYou",
      "prevRank",
      "delta",
      "status",
    ]);
  });

  addWindowOptions(
    metrics.command("sources").description("Top cited domains (Sources table)"),
    "table",
  ).action(async (opts: WindowOpts & { project: string }) => {
    const client = await getClient();
    const data = await client.request<{ sources: FlatRow[] }>("/v1/metrics/sources", {
      query: { projectId: opts.project, ...windowParams(opts) },
    });
    const rows = (data.sources ?? []).map((s) => ({ ...s, isYou: s.isYou ? "you" : "" }));
    printRows(data, rows, parseFormat(opts.format, "table"), [
      "rank",
      "source",
      "citations",
      "usagePct",
      "type",
      "isYou",
      "status",
    ]);
  });

  addWindowOptions(
    metrics.command("trends").description("Time-bucketed metric series (trend chart data)"),
    "table",
  )
    .option("--granularity <g>", "daily|weekly|monthly (default adapts to range)")
    .action(async (opts: WindowOpts & { project: string; granularity?: string }) => {
      const client = await getClient();
      const data = await client.request<{ trends: FlatRow[]; aggregation: string }>(
        "/v1/metrics/trends",
        { query: { projectId: opts.project, ...windowParams(opts), granularity: opts.granularity } },
      );
      const rows = data.trends ?? [];
      // Table/CSV: lead with the headline series; keep per-model columns, drop
      // the noisy cat_* series (still present in --format json).
      const first = rows[0] ?? {};
      const cols = [
        "date",
        ...["overall", "mentionSov", "citationSov", "avgRank"].filter((k) => k in first),
        ...Object.keys(first).filter(
          (k) =>
            !["date", "overall", "mentionSov", "citationSov", "avgRank"].includes(k) &&
            !k.startsWith("cat_") &&
            !k.startsWith("rank"),
        ),
      ];
      printRows(data, rows, parseFormat(opts.format, "table"), cols);
    });

  metrics
    .command("heatmap")
    .description("Category × model visibility grid")
    .requiredOption("--project <id>", "Project id")
    .option("--until <date>", "Snapshot as of this date (default: latest run)")
    .option("--format <fmt>", "Output: json|table|csv (default table)")
    .action(async (opts: { project: string; until?: string; format?: string }) => {
      const client = await getClient();
      const data = await client.request<{
        models: { model: string; name: string }[];
        categories: string[];
        cells: Record<string, Record<string, { avgScore: number | null }>>;
      }>(`/v1/metrics/heatmap/${opts.project}`, { query: { until: opts.until } });
      const rows = (data.categories ?? []).map((cat) => {
        const row: FlatRow = { category: cat };
        for (const m of data.models ?? []) {
          row[m.model] = data.cells?.[cat]?.[m.model]?.avgScore ?? null;
        }
        return row;
      });
      printRows(data, rows, parseFormat(opts.format, "table"));
    });

  program
    .command("export-results")
    .description("Full-history NDJSON export, streamed server-side (no client paging)")
    .requiredOption("--project <id>", "Project id")
    .option(
      "--since <date>",
      "Only rows created STRICTLY AFTER this ISO timestamp (the server's resume-cursor semantics: pass the last createdAt you already have)",
    )
    .option("-o, --output <file>", "Write to file instead of stdout")
    .action(async (opts: { project: string; since?: string; output?: string }) => {
      const client = await getClient();
      const res = await client.requestRaw("/v1/export-full", {
        query: { projectId: opts.project, since: opts.since },
      });
      if (!res.body) throw new Error("Empty response body");
      if (opts.output) {
        const { createWriteStream } = await import("node:fs");
        const { Writable } = await import("node:stream");
        await res.body.pipeTo(Writable.toWeb(createWriteStream(opts.output)) as WritableStream);
        console.error(`Wrote ${opts.output}`);
      } else {
        await res.body.pipeTo(stdoutStream());
      }
    });
}

/** stdout as a WritableStream (kept tiny; Bun/Node both support this). */
function stdoutStream(): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      process.stdout.write(chunk);
    },
  });
}
