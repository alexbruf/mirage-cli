import { Command } from "commander";
import { AirtableClient, ApiError, type ListEnvelope, type Query } from "./client.ts";
import { fingerprint, getDefaultBaseUrl, resolveBase, resolveToken } from "./config.ts";
import { parseFormat, renderList, renderObject, type Format } from "./output.ts";

/**
 * Build the Airtable Commander program. Pure function — no side effects, safe
 * to call from in-process wrappers (`@mirage-cli/airtable`) or the `bin.ts`
 * entry.
 *
 * Read-only by construction: the client only speaks GET (see client.ts), so
 * every subcommand here is a read. The command names mirror the Airtable MCP
 * server's *read* tools (`list-bases`, `list-tables`, `describe-table`,
 * `list-records`, `search-records`, `get-record`, `whoami`) — the same
 * vocabulary the official `@airtable/mcp-cli` surfaces — with that CLI's flag
 * names (`--baseId`, `--tableIdOrName`, `--recordId`). The 7 write tools
 * (create/update/delete) are intentionally absent.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name("airtable")
    .description(
      "Airtable CLI — read-only access to the Airtable Web API: bases, table schema, and " +
        "records. Command names mirror the Airtable MCP read tools.",
    )
    .version("0.1.0")
    .option("--token <pat>", "Personal access token (or AIRTABLE_API_KEY env)")
    .option("--base <baseId>", "Default base id appXXXXXXXX (or AIRTABLE_BASE_ID env)")
    .option("--base-url <url>", "API base URL (or AIRTABLE_API_BASE_URL env)")
    .option("-f, --format <fmt>", "Output format: json | jsonl | table | csv", "json")
    .addHelpText(
      "after",
      `
Credentials (resolved per call):
  token:  --token > AIRTABLE_API_KEY > AIRTABLE_TOKEN
  base:   --baseId (per command) > --base > AIRTABLE_BASE_ID
  Create a personal access token at https://airtable.com/create/tokens

Examples:
  airtable list-bases
  airtable list-tables --baseId appXXXXXXXX --detailLevel identifiersOnly
  airtable list-records --baseId appXXX --tableIdOrName Tasks --view Grid \\
    --fields Name,Status --filterByFormula "{Status}='Done'" --all
  airtable search-records --baseId appXXX --tableIdOrName Tasks --searchTerm acme
  airtable get-record --baseId appXXX --tableIdOrName Tasks --recordId recXXX
  airtable whoami
  airtable api /meta/bases                              # raw GET escape hatch`,
    );

  function globalOpts(): {
    token?: string;
    base?: string;
    baseUrl?: string;
    format: Format;
  } {
    const opts = program.opts<{ token?: string; base?: string; baseUrl?: string; format?: string }>();
    return { ...opts, format: parseFormat(opts.format) };
  }

  function fail(err: unknown): never {
    if (err instanceof ApiError) {
      process.stderr.write(
        JSON.stringify({
          error: err.message,
          status: err.status,
          ...(err.hint ? { hint: err.hint } : {}),
        }) + "\n",
      );
    } else {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(JSON.stringify({ error: message }) + "\n");
    }
    process.exit(1);
  }

  function getClient(): AirtableClient {
    const { token, baseUrl } = globalOpts();
    try {
      const { token: pat } = resolveToken({ token });
      return new AirtableClient({ token: pat, ...(baseUrl ? { baseUrl } : {}) });
    } catch (err) {
      return fail(err);
    }
  }

  /** base id from the per-command --baseId, else global --base / env. */
  function baseId(explicit?: string): string {
    try {
      return resolveBase({ base: globalOpts().base }, explicit);
    } catch (err) {
      return fail(err);
    }
  }

  /** Accept the canonical --tableIdOrName or the -t/--table alias. */
  function tableOf(opts: { tableIdOrName?: string; table?: string }): string {
    const t = opts.tableIdOrName ?? opts.table;
    if (!t) fail(new Error("Missing --tableIdOrName <table> (table name or id)"));
    return encodeURIComponent(t);
  }

  function outList(envelope: ListEnvelope, collection: string): void {
    const records = (envelope[collection] as unknown[] | undefined) ?? [];
    console.log(renderList(envelope, records, globalOpts().format));
  }

  function outObject(obj: unknown): void {
    console.log(renderObject(obj, globalOpts().format));
  }

  interface PageFlags {
    all?: boolean;
    maxRecords?: string;
    pageSize?: string;
    offset?: string;
  }

  /**
   * GET a collection; with --all, walk the `offset` cursor up to --maxRecords
   * (no cap when --maxRecords is unset). `collection` names the array key
   * (`records`, `bases`).
   */
  async function runList(
    path: string,
    collection: string,
    flags: PageFlags,
    extra: Query = {},
  ): Promise<void> {
    const client = getClient();
    const pageSize = flags.pageSize;
    const cap = flags.maxRecords ? Number(flags.maxRecords) : undefined;
    try {
      if (!flags.all) {
        const env = await client.get<ListEnvelope>(path, {
          offset: flags.offset,
          ...(pageSize ? { pageSize } : {}),
          ...(cap ? { maxRecords: cap } : {}),
          ...extra,
        });
        outList(env, collection);
        return;
      }
      const acc: unknown[] = [];
      let offset: string | undefined = flags.offset;
      let truncated = false;
      for (;;) {
        const env: ListEnvelope = await client.get<ListEnvelope>(path, {
          offset,
          pageSize: pageSize ?? "100",
          ...extra,
        });
        acc.push(...((env[collection] as unknown[] | undefined) ?? []));
        offset = env.offset;
        if (cap !== undefined && acc.length >= cap) {
          acc.length = cap;
          truncated = Boolean(offset);
          break;
        }
        if (!offset) break;
      }
      const { format } = globalOpts();
      if (format === "json") {
        outObject({
          returned: acc.length,
          ...(truncated ? { truncated: true, hint: "raise --maxRecords to fetch more" } : {}),
          [collection]: acc,
        });
      } else {
        if (truncated) {
          process.stderr.write(`note: returned ${acc.length} records (--maxRecords cap)\n`);
        }
        console.log(renderList({ [collection]: acc }, acc, format));
      }
    } catch (err) {
      fail(err);
    }
  }

  // ── record query flags shared by list-records / search-records ──

  function addRecordQueryFlags(cmd: Command): Command {
    return cmd
      .option("--baseId <id>", "Base id (or --base / AIRTABLE_BASE_ID)")
      .option("--tableIdOrName <table>", "Table name or id")
      .option("-t, --table <table>", "Alias for --tableIdOrName")
      .option("--fields <list>", "Comma-separated fields to return")
      .option("--view <name|id>", "Only records (and order) in this view")
      .option("--maxRecords <n>", "Total record cap")
      .option("--pageSize <n>", "Records per page (max 100)")
      .option("--all", "Fetch every page (up to --maxRecords)")
      .option("--cell-format <fmt>", "json | string (string needs --time-zone & --user-locale)")
      .option("--time-zone <tz>")
      .option("--user-locale <locale>")
      .option("--return-fields-by-field-id", "Key fields by field id instead of name");
  }

  /** Build the Web API query for a record list (sort/fields/format encoding). */
  function recordQuery(
    opts: Record<string, string | string[] | boolean | undefined>,
    sort: string[],
  ): Query {
    const q: Query = {
      ...(opts.fields ? { fields: String(opts.fields).split(",").map((s) => s.trim()) } : {}),
      ...(opts.view ? { view: String(opts.view) } : {}),
      ...(opts.cellFormat ? { cellFormat: String(opts.cellFormat) } : {}),
      ...(opts.timeZone ? { timeZone: String(opts.timeZone) } : {}),
      ...(opts.userLocale ? { userLocale: String(opts.userLocale) } : {}),
      ...(opts.returnFieldsByFieldId ? { returnFieldsByFieldId: "true" } : {}),
    };
    // sort[0][field]=Name&sort[0][direction]=desc (each --sort is "field" or "field:desc")
    sort.forEach((s, i) => {
      const [field, dir] = s.split(":");
      if (field) q[`sort[${i}][field]`] = field;
      q[`sort[${i}][direction]`] = dir === "desc" ? "desc" : "asc";
    });
    return q;
  }

  // ── bases ──

  program
    .command("list-bases")
    .alias("bases")
    .description("List bases the token can access (GET /meta/bases)")
    .option("--all", "Fetch every page")
    .option("--offset <cursor>", "Pagination cursor")
    .action(async (opts: PageFlags) => runList("/meta/bases", "bases", opts));

  // ── schema ──

  function trimTables(tables: Record<string, unknown>[], level?: string): unknown[] {
    if (!level || level === "full") return tables;
    return tables.map((t) => {
      const base = { id: t.id, name: t.name };
      if (level === "tableIdentifiersOnly") return base;
      const ids = (arr: unknown) =>
        Array.isArray(arr) ? arr.map((x) => ({ id: (x as { id: string }).id, name: (x as { name: string }).name })) : [];
      return {
        ...base,
        ...(t.primaryFieldId ? { primaryFieldId: t.primaryFieldId } : {}),
        fields: ids(t.fields),
        views: ids(t.views),
      };
    });
  }

  program
    .command("list-tables")
    .alias("schema")
    .description("List tables/schema for a base (GET /meta/bases/{baseId}/tables)")
    .option("--baseId <id>", "Base id (or --base / AIRTABLE_BASE_ID)")
    .option("--detailLevel <lvl>", "full | identifiersOnly | tableIdentifiersOnly", "full")
    .action(async (opts: { baseId?: string; detailLevel?: string }) => {
      const client = getClient();
      try {
        const env = await client.get<{ tables: Record<string, unknown>[] }>(
          `/meta/bases/${baseId(opts.baseId)}/tables`,
        );
        const tables = trimTables(env.tables ?? [], opts.detailLevel);
        console.log(renderList({ tables }, tables, globalOpts().format));
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("describe-table")
    .description("Describe one table (GET /meta/bases/{baseId}/tables, filtered)")
    .option("--baseId <id>", "Base id (or --base / AIRTABLE_BASE_ID)")
    .option("--tableIdOrName <table>", "Table name or id")
    .option("-t, --table <table>", "Alias for --tableIdOrName")
    .option("--detailLevel <lvl>", "full | identifiersOnly | tableIdentifiersOnly", "full")
    .action(async (opts: { baseId?: string; tableIdOrName?: string; table?: string; detailLevel?: string }) => {
      const want = decodeURIComponent(tableOf(opts));
      const client = getClient();
      try {
        const env = await client.get<{ tables: Record<string, unknown>[] }>(
          `/meta/bases/${baseId(opts.baseId)}/tables`,
        );
        const match = (env.tables ?? []).find((t) => t.id === want || t.name === want);
        if (!match) fail(new Error(`Table not found in base: "${want}"`));
        outObject(trimTables([match], opts.detailLevel)[0]);
      } catch (err) {
        fail(err);
      }
    });

  // ── records ──

  addRecordQueryFlags(
    program
      .command("list-records")
      .alias("records")
      .description("List records in a table (GET /{baseId}/{tableIdOrName})")
      .option("--filterByFormula <formula>", "Airtable formula filter")
      .option("--sort <field...>", "Sort by field, repeatable; suffix :desc (e.g. --sort Name:desc)", (v: string, acc: string[]) => {
        acc.push(v);
        return acc;
      }, [] as string[])
      .option("--offset <cursor>", "Pagination cursor"),
  ).action(async (opts: Record<string, string | string[] | boolean | undefined>) => {
    const path = `/${baseId(opts.baseId as string | undefined)}/${tableOf(opts as { tableIdOrName?: string; table?: string })}`;
    const sort = Array.isArray(opts.sort) ? opts.sort : [];
    await runList(
      path,
      "records",
      {
        all: opts.all as boolean | undefined,
        maxRecords: opts.maxRecords as string | undefined,
        pageSize: opts.pageSize as string | undefined,
        offset: opts.offset as string | undefined,
      },
      {
        ...recordQuery(opts, sort),
        ...(opts.filterByFormula ? { filterByFormula: String(opts.filterByFormula) } : {}),
      },
    );
  });

  addRecordQueryFlags(
    program
      .command("search-records")
      .description("Search records by text (list-records with a generated SEARCH formula)")
      .option("--searchTerm <text>", "Text to find")
      .option("--offset <cursor>", "Pagination cursor"),
  ).action(async (opts: Record<string, string | string[] | boolean | undefined>) => {
    const term = opts.searchTerm ? String(opts.searchTerm) : "";
    if (!term) fail(new Error("Missing --searchTerm <text>"));
    const base = baseId(opts.baseId as string | undefined);
    const table = tableOf(opts as { tableIdOrName?: string; table?: string });
    const client = getClient();

    // Determine which fields to search: explicit --fields, else the table's
    // schema fields (so search works without the caller knowing the columns).
    let searchFields = opts.fields ? String(opts.fields).split(",").map((s) => s.trim()) : [];
    if (searchFields.length === 0) {
      try {
        const schema = await client.get<{ tables: { id: string; name: string; fields: { name: string }[] }[] }>(
          `/meta/bases/${base}/tables`,
        );
        const want = decodeURIComponent(table);
        const t = schema.tables.find((x) => x.id === want || x.name === want);
        searchFields = (t?.fields ?? []).map((f) => f.name);
      } catch (err) {
        fail(err);
      }
    }
    if (searchFields.length === 0) fail(new Error("No fields to search; pass --fields <list>"));

    const esc = (s: string) => s.replace(/"/g, '\\"');
    const formula = `OR(${searchFields
      .map((f) => `SEARCH(LOWER("${esc(term)}"), LOWER({${f}}&""))`)
      .join(",")})`;

    const sort = Array.isArray(opts.sort) ? opts.sort : [];
    await runList(
      `/${base}/${table}`,
      "records",
      {
        all: opts.all as boolean | undefined,
        maxRecords: opts.maxRecords as string | undefined,
        pageSize: opts.pageSize as string | undefined,
        offset: opts.offset as string | undefined,
      },
      { ...recordQuery(opts, sort), filterByFormula: formula },
    );
  });

  program
    .command("get-record")
    .description("Get one record (GET /{baseId}/{tableIdOrName}/{recordId})")
    .option("--baseId <id>", "Base id (or --base / AIRTABLE_BASE_ID)")
    .option("--tableIdOrName <table>", "Table name or id")
    .option("-t, --table <table>", "Alias for --tableIdOrName")
    .requiredOption("--recordId <id>", "Record id recXXXXXXXX")
    .option("--cell-format <fmt>", "json | string")
    .option("--return-fields-by-field-id", "Key fields by field id instead of name")
    .action(
      async (opts: {
        baseId?: string;
        tableIdOrName?: string;
        table?: string;
        recordId: string;
        cellFormat?: string;
        returnFieldsByFieldId?: boolean;
      }) => {
        const path = `/${baseId(opts.baseId)}/${tableOf(opts)}/${encodeURIComponent(opts.recordId)}`;
        const client = getClient();
        try {
          outObject(
            await client.get(path, {
              ...(opts.cellFormat ? { cellFormat: opts.cellFormat } : {}),
              ...(opts.returnFieldsByFieldId ? { returnFieldsByFieldId: "true" } : {}),
            }),
          );
        } catch (err) {
          fail(err);
        }
      },
    );

  // ── whoami ──

  program
    .command("whoami")
    .description("Show the token's user id and scopes (GET /meta/whoami)")
    .action(async () => {
      const { token } = globalOpts();
      const client = getClient();
      try {
        const me = await client.get<Record<string, unknown>>("/meta/whoami");
        outObject({
          ...me,
          token: fingerprint(resolveToken({ token }).token),
        });
      } catch (err) {
        fail(err);
      }
    });

  // ── raw GET escape hatch ──

  program
    .command("api <path>")
    .description("Raw GET against any Airtable API path, e.g. `airtable api /meta/bases`")
    .option(
      "-q, --query <k=v...>",
      "Query params (repeatable; repeat a key to send it multiple times)",
      (v: string, acc: string[]) => {
        acc.push(v);
        return acc;
      },
      [] as string[],
    )
    .action(async (path: string, opts: { query: string[] }) => {
      const query: Query = {};
      for (const pair of opts.query) {
        const sep = pair.indexOf("=");
        if (sep <= 0) fail(new Error(`Bad query param "${pair}" — expected k=v`));
        const key = pair.slice(0, sep);
        const value = pair.slice(sep + 1);
        const existing = query[key];
        if (existing === undefined) query[key] = value;
        else if (Array.isArray(existing)) existing.push(value);
        else query[key] = [String(existing), value];
      }
      const client = getClient();
      try {
        outObject(await client.get(path, query));
      } catch (err) {
        fail(err);
      }
    });

  return program;
}

export { getDefaultBaseUrl };
