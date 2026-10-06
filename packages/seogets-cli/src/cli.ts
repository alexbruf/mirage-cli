import { Command, Option } from "commander";
import packageJson from "../package.json" with { type: "json" };
import {
  SEARCH_METRICS,
  gscCompare,
  gscTopBy,
  type GscDimension,
  type GscMetric,
} from "./gsc-top.ts";
import { McpClient, PERFORMANCE_TOOL, unwrapToolResult } from "./mcp.ts";
import { writeObject, writeOutput, type OutputOpts } from "./output.ts";
import {
  changeRows,
  collectPages,
  hasMore,
  listRows,
  pageRows,
  performanceRows,
  performanceWarnings,
  queryRows,
} from "./site-data.ts";

function newClient(globals: { token?: string; url?: string }): McpClient {
  return new McpClient({ token: globals.token, url: globals.url });
}

interface GscOpts extends OutputOpts {
  page?: number;
  pageSize?: number;
  filters?: string;
  brandedQueries?: boolean;
  metrics?: string;
}

interface PerfOpts extends OutputOpts {
  metrics?: string;
  filters?: string;
  brandedQueries?: boolean;
  raw?: boolean;
}

interface ListPageOpts extends OutputOpts {
  page: number;
  pageSize: number;
  all?: boolean;
  raw?: boolean;
}

interface ChangesOpts extends OutputOpts {
  from?: string;
  to?: string;
  types?: string;
  pageContains?: string;
  group?: string;
  priorityOnly?: boolean;
  diff?: boolean;
  raw?: boolean;
}

interface RawOpts extends OutputOpts {
  raw?: boolean;
}

interface IndexingStatusOpts extends OutputOpts {
  status?: string[];
  page?: number;
  crawledDaysAgo?: number;
  filters?: string;
}

interface GscTopOpts extends GscOpts {
  dim: GscDimension;
  by: GscMetric;
  limit: number;
  rowsOnly: boolean;
  maxPages?: number;
}

interface GscCompareOpts extends GscOpts {
  query: string;
  currentStart: string;
  currentEnd: string;
  compareStart: string;
  compareEnd: string;
  metric: GscMetric;
  maxPages?: number;
}

function coerceBoolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("value must be 'true' or 'false'");
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error("value must be a positive integer");
  return parsed;
}

function parseFilters(value?: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--filters must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function splitList(value?: string): string[] | undefined {
  if (!value) return undefined;
  const items = value.split(",").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/**
 * `--filters` for the performance commands: a JSON array becomes the
 * `filters` field; a JSON object is merged into the arguments as-is, which
 * keeps the `gsc --filters '{"filters":[...]}'` form working.
 */
function applyFilters(args: Record<string, unknown>, value?: string): void {
  if (!value) return;
  const parsed = JSON.parse(value) as unknown;
  if (Array.isArray(parsed)) {
    args.filters = parsed;
    return;
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("--filters must be a JSON array of filters or a JSON object of arguments");
  }
  Object.assign(args, parsed);
}

function writeOutputOrRaw(envelope: unknown, rows: unknown[], opts: RawOpts): void {
  if (opts.raw) writeObject(envelope, opts);
  else writeOutput(rows, opts);
}

function warn(lines: string[]): void {
  for (const line of lines) console.error(`# ${line}`);
}

function performanceArgs(
  target: Record<string, unknown>,
  start: string,
  end: string,
  dims: string | undefined,
  opts: PerfOpts,
): Record<string, unknown> {
  const args: Record<string, unknown> = { ...target, start_date: start, end_date: end };
  const dimensions = splitList(dims);
  if (dimensions) args.dimensions = dimensions;
  const metrics = splitList(opts.metrics);
  if (metrics) args.metrics = metrics;
  if (opts.brandedQueries !== undefined) args.branded_queries = opts.brandedQueries;
  applyFilters(args, opts.filters);
  return args;
}

function writePerformance(result: unknown, opts: PerfOpts): void {
  const envelope = unwrapToolResult(result);
  if (opts.raw) {
    writeObject(envelope, opts);
    return;
  }
  warn(performanceWarnings(envelope));
  writeOutput(performanceRows(envelope), opts);
}

function addPerfFlags<T extends Command>(cmd: T): T {
  return cmd
    .option(
      "--metrics <list>",
      "comma-separated metrics: clicks,impressions,ctr,position (search) and " +
        "activeUsers,sessions,engagedSessions,engagementRate,keyEvents,revenue (GA4). " +
        "Default: every metric the site has data for",
    )
    .option(
      "--branded-queries <bool>",
      "filter to branded (true) or non-branded (false) queries; omit for both",
      coerceBoolean,
    )
    .option(
      "--filters <json>",
      'dimension filters as a JSON array, e.g. \'[{"dimension":"page","operator":"contains","expression":"/blog/"}]\'',
    )
    .option("--raw", "emit the upstream envelope instead of typed rows") as T;
}

function addListPageFlags<T extends Command>(cmd: T): T {
  return cmd
    .option("--page <n>", "page number (1-based)", parsePositiveInteger, 1)
    .option("--page-size <n>", "rows per page", parsePositiveInteger, 1000)
    .option("--all", "fetch every page from --page on until the server reports no more")
    .option("--raw", "emit the upstream envelope of one page instead of rows") as T;
}

async function runListPages<T>(
  client: McpClient,
  tool: string,
  property: string,
  toRows: (envelope: unknown) => T[],
  opts: ListPageOpts,
): Promise<void> {
  const fetchPage = async (page: number) =>
    unwrapToolResult(
      await client.callTool(tool, { property, page, page_size: opts.pageSize }),
    );
  if (opts.raw) {
    writeObject(await fetchPage(opts.page), opts);
    return;
  }
  if (opts.all) {
    const result = await collectPages(fetchPage, toRows, opts.page);
    if (!result.complete) warn([`stopped after ${result.pages} pages; more rows remain`]);
    writeOutput(result.rows, opts);
    return;
  }
  const envelope = await fetchPage(opts.page);
  if (hasMore(envelope)) {
    warn([`more rows remain: use --page ${opts.page + 1} or --all`]);
  }
  writeOutput(toRows(envelope), opts);
}

function addFormatFlags<T extends Command>(cmd: T): T {
  return cmd
    .addOption(
      new Option("-f, --format <fmt>", "output format")
        .choices(["ascii", "json", "csv", "markdown", "ndjson"])
        .default("ascii"),
    )
    .option("-o, --output <file>", "write to file instead of stdout") as T;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("seogets")
    .description(
      "CLI for the SEO Gets MCP — list GSC properties, pull GSC and GA4 performance " +
        "for sites and portfolios, list pages, queries, content changes, content groups " +
        "and topic clusters, and inspect indexing status. " +
        "Speaks JSON-RPC 2.0 to https://app.seogets.com/mcp.",
    )
    .version(packageJson.version)
    .option("--token <token>", "MCP bearer token (defaults to SEOGETS_MCP_TOKEN env)")
    .option("--url <url>", "MCP endpoint URL (defaults to SEOGETS_MCP_URL or https://app.seogets.com/mcp)");

  // ── tools (raw introspection) ──────────────────────────────────────
  addFormatFlags(program.command("tools").description("List MCP tools available to this token"))
    .action(async (opts: OutputOpts, cmd: Command) => {
      const globals = cmd.optsWithGlobals();
      const tools = await newClient(globals).listTools();
      writeObject(tools, opts);
    });

  // ── sites ──────────────────────────────────────────────────────────
  addFormatFlags(
    program
      .command("sites")
      .description("List GSC properties accessible to this token (MCP: list_sites)")
      .option("--filter <mode>", "filter (default 'all')", "all"),
  ).action(async (opts: OutputOpts & { filter: string }, cmd: Command) => {
    const globals = cmd.optsWithGlobals();
    const result = await newClient(globals).callTool("list_sites", { filter: opts.filter });
    writeObject(unwrapToolResult(result), opts);
  });

  // ── gsc ────────────────────────────────────────────────────────────
  addFormatFlags(
    program
      .command("gsc <site> <start_date> <end_date> [dimensions]")
      .description(
        "GSC search analytics (MCP: get_site_performance, search metrics only). " +
          "<dimensions> is a comma-separated subset of query,page,date,country,device,contentGroup,topicCluster. " +
          "Use `perf` for GA4 metrics and typed rows.",
      )
      .addOption(
        new Option("--page <n>", "deprecated: the server no longer paginates; ignored")
          .argParser((v: string) => parseInt(v, 10))
          .hideHelp(),
      )
      .addOption(
        new Option("--page-size <n>", "deprecated: the server no longer paginates; ignored")
          .argParser((v: string) => parseInt(v, 10))
          .hideHelp(),
      )
      .option(
        "--metrics <list>",
        "comma-separated metrics to request",
        SEARCH_METRICS.join(","),
      )
      .option(
        "--branded-queries <bool>",
        "filter to branded (true) or non-branded (false) queries; omit for both",
        coerceBoolean,
      )
      .option(
        "--filters <json>",
        "extra JSON to merge into arguments; the server rejects unknown keys, " +
          "so only schema fields work (e.g. '{\"filters\":[...]}')",
      ),
  ).action(
    async (
      site: string,
      start: string,
      end: string,
      dims: string | undefined,
      opts: GscOpts,
      cmd: Command,
    ) => {
      const globals = cmd.optsWithGlobals();
      if (opts.page !== undefined || opts.pageSize !== undefined) {
        console.error(
          "# warning: --page/--page-size are deprecated and ignored; " +
            "get_site_performance returns the whole window in one response",
        );
      }
      const args: Record<string, unknown> = {
        property: site,
        start_date: start,
        end_date: end,
      };
      if (dims) args.dimensions = dims.split(",").map((d) => d.trim()).filter(Boolean);
      const metrics = splitList(opts.metrics);
      if (metrics) args.metrics = metrics;
      if (opts.brandedQueries !== undefined) args.branded_queries = opts.brandedQueries;
      if (opts.filters) Object.assign(args, JSON.parse(opts.filters));
      const result = await newClient(globals).callTool(PERFORMANCE_TOOL, args);
      writeObject(unwrapToolResult(result), opts);
    },
  );

  // ── perf (GSC + GA4) ───────────────────────────────────────────────
  addFormatFlags(
    addPerfFlags(
      program
        .command("perf <site> <start_date> <end_date> [dimensions]")
        .description(
          "Merged GSC + GA4 performance as typed rows (MCP: get_site_performance). " +
            "<dimensions> is a comma-separated subset of " +
            "date,query,page,country,device,contentGroup,topicCluster,sessionSourceMedium,eventName. " +
            "GA4 has no query dimension, so query rows carry search metrics only.",
        ),
    ),
  ).action(
    async (
      site: string,
      start: string,
      end: string,
      dims: string | undefined,
      opts: PerfOpts,
      cmd: Command,
    ) => {
      const args = performanceArgs({ property: site }, start, end, dims, opts);
      const result = await newClient(cmd.optsWithGlobals()).callTool(PERFORMANCE_TOOL, args);
      writePerformance(result, opts);
    },
  );

  // ── portfolio ──────────────────────────────────────────────────────
  const portfolio = program
    .command("portfolio")
    .description("Portfolios (groups of sites) and site migrations");

  addFormatFlags(
    portfolio
      .command("list")
      .description("Portfolios and migrations visible to this token (MCP: list_portfolios)")
      .option("--raw", "emit the upstream envelope instead of rows"),
  ).action(async (opts: RawOpts, cmd: Command) => {
    const envelope = unwrapToolResult(
      await newClient(cmd.optsWithGlobals()).callTool("list_portfolios", {}),
    );
    writeOutputOrRaw(envelope, listRows(envelope, "portfolios"), opts);
  });

  addFormatFlags(
    addPerfFlags(
      portfolio
        .command("perf <portfolio> <start_date> <end_date> [dimensions]")
        .description(
          "Combined GSC + GA4 performance across a portfolio's sites (MCP: get_portfolio_performance). " +
            "<portfolio> is a name or id from `portfolio list`. Add the `site` dimension " +
            "for one row per site instead of summed rows.",
        ),
    ),
  ).action(
    async (
      name: string,
      start: string,
      end: string,
      dims: string | undefined,
      opts: PerfOpts,
      cmd: Command,
    ) => {
      const args = performanceArgs({ portfolio: name }, start, end, dims, opts);
      const result = await newClient(cmd.optsWithGlobals()).callTool(
        "get_portfolio_performance",
        args,
      );
      writePerformance(result, opts);
    },
  );

  // ── changes ────────────────────────────────────────────────────────
  addFormatFlags(
    program
      .command("changes <site>")
      .description(
        "Content-change timeline: annotations, detected content edits, HTTP status " +
          "changes, internal link changes and Google updates (MCP: list_content_changes). " +
          "Defaults to the last 28 days. Detected changes need an SEO Gets super site.",
      )
      .option("--from <date>", "start date (YYYY-MM-DD)")
      .option("--to <date>", "end date (YYYY-MM-DD)")
      .option(
        "--types <list>",
        "comma-separated event types: content_changed,http_status_changed,internal_links," +
          "tracking_changes,annotations,google_updates (default all)",
      )
      .option("--page-contains <text>", "only pages whose URL contains this text")
      .option("--group <name>", "only pages in this content group")
      .option("--priority-only", "only pages in priority content groups")
      .option("--diff", "include added/removed text for up to 10 newest content changes (slower)")
      .option("--raw", "emit the upstream envelope instead of rows"),
  ).action(async (site: string, opts: ChangesOpts, cmd: Command) => {
    const args: Record<string, unknown> = { property: site };
    if (opts.from) args.start_date = opts.from;
    if (opts.to) args.end_date = opts.to;
    const types = splitList(opts.types);
    if (types) args.event_types = types;
    if (opts.pageContains) args.page_contains = opts.pageContains;
    if (opts.group) args.content_group = opts.group;
    if (opts.priorityOnly) args.priority_only = true;
    if (opts.diff) args.include_text_diff = true;
    const envelope = unwrapToolResult(
      await newClient(cmd.optsWithGlobals()).callTool("list_content_changes", args),
    );
    if (!opts.raw) warn(performanceWarnings(envelope));
    writeOutputOrRaw(envelope, changeRows(envelope), opts);
  });

  // ── pages / queries ────────────────────────────────────────────────
  addFormatFlags(
    addListPageFlags(
      program
        .command("pages <site>")
        .description("Every page with search data in the last 16 months (MCP: list_site_pages)"),
    ),
  ).action(async (site: string, opts: ListPageOpts, cmd: Command) => {
    await runListPages(newClient(cmd.optsWithGlobals()), "list_site_pages", site, pageRows, opts);
  });

  addFormatFlags(
    addListPageFlags(
      program
        .command("queries <site>")
        .description("Every search query in the last 16 months (MCP: list_site_queries)"),
    ),
  ).action(async (site: string, opts: ListPageOpts, cmd: Command) => {
    await runListPages(
      newClient(cmd.optsWithGlobals()),
      "list_site_queries",
      site,
      queryRows,
      opts,
    );
  });

  // ── groups / clusters ──────────────────────────────────────────────
  addFormatFlags(
    program
      .command("groups <site>")
      .description("Content groups: pages segmented by URL filters (MCP: list_content_groups)")
      .option("--raw", "emit the upstream envelope instead of rows"),
  ).action(async (site: string, opts: RawOpts, cmd: Command) => {
    const envelope = unwrapToolResult(
      await newClient(cmd.optsWithGlobals()).callTool("list_content_groups", { property: site }),
    );
    writeOutputOrRaw(envelope, listRows(envelope, "content_groups"), opts);
  });

  addFormatFlags(
    program
      .command("clusters <site>")
      .description("Topic clusters: queries segmented by keyword filters (MCP: list_topic_clusters)")
      .option("--raw", "emit the upstream envelope instead of rows"),
  ).action(async (site: string, opts: RawOpts, cmd: Command) => {
    const envelope = unwrapToolResult(
      await newClient(cmd.optsWithGlobals()).callTool("list_topic_clusters", { property: site }),
    );
    writeOutputOrRaw(envelope, listRows(envelope, "topic_clusters"), opts);
  });

  // ── gsc-top ────────────────────────────────────────────────────────
  addFormatFlags(
    program
      .command("gsc-top <site> <start_date> <end_date>")
      .description("True top-N GSC rows from the full single-response window")
      .addOption(new Option("--dim <dimension>").choices(["query", "page"]).default("query"))
      .addOption(
        new Option("--by <metric>")
          .choices(["impressions", "clicks", "position"])
          .default("impressions"),
      )
      .option("-n, --limit <n>", "number of rows", parsePositiveInteger, 10)
      .addOption(
        new Option("--page-size <n>", "deprecated: the server no longer paginates; ignored")
          .argParser(parsePositiveInteger)
          .hideHelp(),
      )
      .addOption(
        new Option("--max-pages <n>", "deprecated: the server no longer paginates; ignored")
          .argParser(parsePositiveInteger)
          .hideHelp(),
      )
      .option("--branded-queries <bool>", "server-side branded query filter", coerceBoolean)
      .option("--filters <json>", "extra get_site_performance arguments as JSON")
      .option("--rows-only", "emit only the dimension and selected metric", true)
      .option("--no-rows-only", "emit complete upstream rows"),
  ).action(async (site: string, start: string, end: string, opts: GscTopOpts, cmd: Command) => {
    const result = await gscTopBy(newClient(cmd.optsWithGlobals()), {
      site,
      startDate: start,
      endDate: end,
      dimension: opts.dim,
      metric: opts.by,
      limit: opts.limit,
      brandedQueries: opts.brandedQueries,
      filters: parseFilters(opts.filters),
    });
    if (result.truncatedByCap) {
      console.error(
        "# warning: the server returned its row cap; results may be incomplete",
      );
    }
    const rows = opts.rowsOnly
      ? result.rows.map((row) => ({ [opts.dim]: row[opts.dim], [opts.by]: row[opts.by] }))
      : result.rows;
    writeOutput(rows, opts);
  });

  // ── gsc-compare ────────────────────────────────────────────────────
  addFormatFlags(
    program
      .command("gsc-compare <site>")
      .description("Compare one exact GSC query across two windows")
      .requiredOption("--query <query>", "exact query label")
      .requiredOption("--current-start <date>", "current window start")
      .requiredOption("--current-end <date>", "current window end")
      .requiredOption("--compare-start <date>", "comparison window start")
      .requiredOption("--compare-end <date>", "comparison window end")
      .addOption(
        new Option("--metric <metric>")
          .choices(["impressions", "clicks", "position"])
          .default("impressions"),
      )
      .addOption(
        new Option("--page-size <n>", "deprecated: the server no longer paginates; ignored")
          .argParser(parsePositiveInteger)
          .hideHelp(),
      )
      .addOption(
        new Option("--max-pages <n>", "deprecated: the server no longer paginates; ignored")
          .argParser(parsePositiveInteger)
          .hideHelp(),
      )
      .option("--branded-queries <bool>", "server-side branded query filter", coerceBoolean)
      .option("--filters <json>", "extra get_site_performance arguments as JSON"),
  ).action(async (site: string, opts: GscCompareOpts, cmd: Command) => {
    const result = await gscCompare(newClient(cmd.optsWithGlobals()), {
      site,
      query: opts.query,
      currentStart: opts.currentStart,
      currentEnd: opts.currentEnd,
      compareStart: opts.compareStart,
      compareEnd: opts.compareEnd,
      metric: opts.metric,
      brandedQueries: opts.brandedQueries,
      filters: parseFilters(opts.filters),
    });
    if (result.truncated) {
      console.error(
        "# warning: the server returned its row cap; comparison may be incomplete",
      );
    }
    writeObject(result, opts);
  });

  // ── indexing ───────────────────────────────────────────────────────
  const indexing = program.command("indexing").description("Indexing-related MCP tools");

  addFormatFlags(
    indexing
      .command("overview <site>")
      .description("Indexing overview: total pages, by coverage state, at-risk pages (MCP: get_indexing_overview)"),
  ).action(async (site: string, opts: OutputOpts, cmd: Command) => {
    const globals = cmd.optsWithGlobals();
    const result = await newClient(globals).callTool("get_indexing_overview", { property: site });
    writeObject(unwrapToolResult(result), opts);
  });

  addFormatFlags(
    indexing
      .command("status <site>")
      .description("Per-page indexing detail (MCP: get_indexing_status)")
      .option(
        "--status <state...>",
        'coverage state filter (repeatable). e.g. --status "Crawled - currently not indexed"',
      )
      .option(
        "--crawled-days-ago <n>",
        "filter pages last crawled at least N days ago",
        (v: string) => parseInt(v, 10),
        0,
      )
      .option("--page <n>", "page number (1-based, default 1)", (v: string) => parseInt(v, 10), 1)
      .option("--filters <json>", "extra filter JSON to merge into arguments"),
  ).action(async (site: string, opts: IndexingStatusOpts, cmd: Command) => {
    const globals = cmd.optsWithGlobals();
    const args: Record<string, unknown> = {
      property: site,
      filters: opts.filters ? JSON.parse(opts.filters) : [],
      status_filter: opts.status ?? [],
      crawled_days_ago: opts.crawledDaysAgo ?? 0,
      page: opts.page ?? 1,
    };
    const result = await newClient(globals).callTool("get_indexing_status", args);
    writeObject(unwrapToolResult(result), opts);
  });

  // ── call (raw escape hatch) ────────────────────────────────────────
  addFormatFlags(
    program
      .command("call <tool> [json_args]")
      .description("Call any MCP tool by name with raw JSON arguments"),
  ).action(async (tool: string, jsonArgs: string | undefined, opts: OutputOpts, cmd: Command) => {
    const globals = cmd.optsWithGlobals();
    const args = jsonArgs ? (JSON.parse(jsonArgs) as Record<string, unknown>) : {};
    const result = await newClient(globals).callTool(tool, args);
    writeObject(unwrapToolResult(result), opts);
  });

  return program;
}
