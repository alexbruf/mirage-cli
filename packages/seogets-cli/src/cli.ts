import { Command, Option } from "commander";
import packageJson from "../package.json" with { type: "json" };
import {
  gscCompare,
  gscTopBy,
  type GscDimension,
  type GscMetric,
} from "./gsc-top.ts";
import { McpClient, unwrapToolResult } from "./mcp.ts";
import { writeObject, writeOutput, type OutputOpts } from "./output.ts";

function newClient(globals: { token?: string; url?: string }): McpClient {
  return new McpClient({ token: globals.token, url: globals.url });
}

interface GscOpts extends OutputOpts {
  page?: number;
  pageSize?: number;
  filters?: string;
  brandedQueries?: boolean;
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
      "CLI for the SEO Gets MCP — list GSC properties, pull GSC performance, " +
        "and inspect indexing status. Speaks JSON-RPC 2.0 to https://app.seogets.com/mcp.",
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
        "GSC search analytics (MCP: get_gsc_performance). " +
          "<dimensions> is a comma-separated subset of query,page,date,country,device,contentGroup,topicCluster.",
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
            "get_gsc_performance returns the whole window in one response",
        );
      }
      const args: Record<string, unknown> = {
        property: site,
        start_date: start,
        end_date: end,
      };
      if (dims) args.dimensions = dims.split(",").map((d) => d.trim()).filter(Boolean);
      if (opts.brandedQueries !== undefined) args.branded_queries = opts.brandedQueries;
      if (opts.filters) Object.assign(args, JSON.parse(opts.filters));
      const result = await newClient(globals).callTool("get_gsc_performance", args);
      writeObject(unwrapToolResult(result), opts);
    },
  );

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
      .option("--filters <json>", "extra get_gsc_performance arguments as JSON")
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
      .option("--filters <json>", "extra get_gsc_performance arguments as JSON"),
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
