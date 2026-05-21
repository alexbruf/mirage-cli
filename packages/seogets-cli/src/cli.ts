import { Command, Option } from "commander";
import { McpClient, unwrapToolResult } from "./mcp.ts";
import { writeObject, type OutputOpts } from "./output.ts";

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
    .version("0.1.0")
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
      .option("--page <n>", "page number (1-based)", (v: string) => parseInt(v, 10), 1)
      .option("--page-size <n>", "rows per page", (v: string) => parseInt(v, 10), 1000)
      .option(
        "--branded-queries <bool>",
        "filter to branded (true) or non-branded (false) queries; omit for both",
        (v: string) => {
          if (v === "true") return true;
          if (v === "false") return false;
          throw new Error("--branded-queries must be 'true' or 'false'");
        },
      )
      .option(
        "--filters <json>",
        "extra filter JSON to merge into arguments (e.g. '{\"countries\":[\"US\"]}')",
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
      const args: Record<string, unknown> = {
        site,
        start_date: start,
        end_date: end,
        page: opts.page ?? 1,
        page_size: opts.pageSize ?? 1000,
      };
      if (dims) args.dimensions = dims.split(",").map((d) => d.trim()).filter(Boolean);
      if (opts.brandedQueries !== undefined) args.branded_queries = opts.brandedQueries;
      if (opts.filters) Object.assign(args, JSON.parse(opts.filters));
      const result = await newClient(globals).callTool("get_gsc_performance", args);
      writeObject(unwrapToolResult(result), opts);
    },
  );

  // ── indexing ───────────────────────────────────────────────────────
  const indexing = program.command("indexing").description("Indexing-related MCP tools");

  addFormatFlags(
    indexing
      .command("overview <site>")
      .description("Indexing overview: total pages, by coverage state, at-risk pages (MCP: get_indexing_overview)"),
  ).action(async (site: string, opts: OutputOpts, cmd: Command) => {
    const globals = cmd.optsWithGlobals();
    const result = await newClient(globals).callTool("get_indexing_overview", { site });
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
      site,
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

if (import.meta.main) {
  buildProgram()
    .parseAsync()
    .catch((err: Error) => {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    });
}
