/**
 * windsor CLI as a commander.js program. `buildProgram()` has no side effects
 * on import; there is no top-level `.parseAsync()`. Every command is a
 * fetch-only GET against Windsor's REST API, so the program is workerd-safe
 * and read-only. The missing-key path throws rather than calling
 * `process.exit`, so it surfaces cleanly through in-process runners.
 */
import { Command } from "commander";
import { WindsorClient, type Row } from "./client.ts";
import { parseFormat, render } from "./format.ts";
import { parseWhere } from "./where.ts";

const VERSION = "0.1.0";

function getClient(): WindsorClient {
  const apiKey = process.env.WINDSOR_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing WINDSOR_API_KEY. Set it in your environment (get a key from " +
        "https://onboard.windsor.ai/app/data-preview).",
    );
  }
  return new WindsorClient(apiKey);
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function out(rows: Row[], format: string): void {
  console.log(render(rows, parseFormat(format)));
}

function withFormat(cmd: Command, fallback = "table"): Command {
  return cmd.option("-f, --format <fmt>", "table | json | jsonl | csv", fallback);
}

function matches(row: Row, search: string | undefined, keys: string[]): boolean {
  if (!search) return true;
  const q = search.toLowerCase();
  return keys.some((k) => String(row[k] ?? "").toLowerCase().includes(q));
}

/** `--since` accepts 30d / 12w / 6m / 1y, a Windsor preset, or YYYY-MM-DD. */
export function dateParams(since?: string, until?: string): Record<string, string> {
  if (until && !(since && /^\d{4}-\d{2}-\d{2}$/.test(since))) {
    throw new Error("--until needs a --since date (YYYY-MM-DD).");
  }
  if (!since) return { date_preset: "last_30d" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
      throw new Error(`Invalid --until "${until}". Use YYYY-MM-DD.`);
    }
    return until ? { date_from: since, date_to: until } : { date_from: since };
  }
  if (/^\d+[dwmy]T?$/.test(since)) return { date_preset: `last_${since}` };
  if (/^(last|this)_\w+$/.test(since)) return { date_preset: since };
  throw new Error(
    `Invalid --since "${since}". Use e.g. 30d, 12w, 6m, 1y, last_year, this_month, or YYYY-MM-DD.`,
  );
}

/** Build the Windsor query params for `windsor query`. Exported for tests. */
export function queryParams(o: {
  fields: string;
  where?: string[];
  filter?: string;
  since?: string;
  until?: string;
  accounts?: string;
  limit?: string;
  param?: string[];
}): Record<string, string> {
  const fields = o.fields
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  if (!fields.length) throw new Error("Provide at least one field, e.g. --fields date,campaign,spend.");

  const params: Record<string, string> = { fields: fields.join(","), ...dateParams(o.since, o.until) };

  if (o.where?.length && o.filter) throw new Error("Pass either --where or --filter, not both.");
  if (o.where?.length) params.filter = JSON.stringify(parseWhere(o.where));
  if (o.filter) {
    try {
      JSON.parse(o.filter);
    } catch {
      throw new Error(`--filter must be Windsor filter JSON, e.g. '[["spend","gt",100]]'.`);
    }
    params.filter = o.filter;
  }
  if (o.accounts) params.select_accounts = o.accounts.replace(/\s+/g, "");
  if (o.limit) {
    if (!/^\d+$/.test(o.limit)) throw new Error(`Invalid --limit "${o.limit}". Use a whole number.`);
    params._max_rows = o.limit;
  }
  for (const p of o.param ?? []) {
    const eq = p.indexOf("=");
    if (eq < 1) throw new Error(`Invalid --param "${p}". Use key=value, e.g. --param include_inactive=true.`);
    const key = p.slice(0, eq);
    if (key === "api_key") throw new Error("--param cannot set api_key; use WINDSOR_API_KEY.");
    params[key] = p.slice(eq + 1);
  }
  return params;
}

/**
 * Build a fresh, fully-configured `windsor` Commander program. No side effects
 * on import; the caller decides when to `.parseAsync()`.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name("windsor")
    .description("Explore and download data from any Windsor.ai connector (read-only)")
    .version(VERSION);

  withFormat(
    program
      .command("connectors [search]")
      .description("List every Windsor connector id (e.g. google_ads, facebook, googleanalytics4)"),
  ).action(async (search: string | undefined, o: any) => {
    const ids = await getClient().listConnectors();
    out(
      ids.map((id) => ({ connector: id })).filter((r) => matches(r, search, ["connector"])),
      o.format,
    );
  });

  withFormat(
    program
      .command("accounts [connector]")
      .description("List connected accounts, for one connector or all of them"),
  ).action(async (connector: string | undefined, o: any) => {
    out(await getClient().listAccounts(connector), o.format);
  });

  withFormat(
    program
      .command("fields <connector> [search]")
      .description("List a connector's fields; search matches id, name, and description")
      .option("-t, --type <type>", "only fields of this type (TEXT, NUMERIC, DATE, PERCENT, ...)"),
  ).action(async (connector: string, search: string | undefined, o: any) => {
    const fields = await getClient().listFields(connector);
    const type = o.type?.toUpperCase();
    const rows = fields
      .filter((f) => matches(f, search, ["id", "name", "description"]))
      .filter((f) => !type || String(f.type).toUpperCase() === type)
      .map((f) => ({ id: f.id, name: f.name, type: f.type, description: f.description }));
    out(rows, o.format);
  });

  withFormat(
    program
      .command("options <connector>")
      .description("List a connector's options; pass them to `query` with --param key=value"),
  ).action(async (connector: string, o: any) => {
    const opts = await getClient().listOptions(connector);
    out(
      opts.map((x) => ({
        id: x.id,
        name: x.name,
        type: x.type,
        default: x.default,
        description: x.description,
      })),
      o.format,
    );
  });

  withFormat(
    program.command("custom-fields").description("List custom fields defined in this Windsor account"),
  ).action(async (o: any) => {
    out(await getClient().listCustomFields(), o.format);
  });

  withFormat(
    program
      .command("query <connector>")
      .description("Fetch rows from a connector. Filtering runs on Windsor's side.")
      .requiredOption("-F, --fields <list>", "comma-separated field ids (see `windsor fields <connector>`)")
      .option(
        "-w, --where <expr>",
        "SQL-like filter, repeatable (ANDed): = != > >= < <= contains like 'x%' is [not] null, and/or, ()",
        collect,
      )
      .option("--filter <json>", "raw Windsor filter JSON instead of --where")
      .option("-s, --since <range|date>", "30d | 12w | 6m | 1y | last_year | this_month | YYYY-MM-DD", "30d")
      .option("-u, --until <date>", "end date YYYY-MM-DD (only with a --since date)")
      .option("-a, --accounts <ids>", "comma-separated account ids (see `windsor accounts <connector>`)")
      .option("-n, --limit <n>", "max rows Windsor returns")
      .option("-p, --param <key=value>", "extra query param, repeatable (connector options)", collect)
      .option("--explain", "print the request URL (key redacted) instead of running it"),
  ).action(async (connector: string, o: any) => {
    const params = queryParams(o);
    if (o.explain) {
      console.log(WindsorClient.explainUrl(connector, params));
      return;
    }
    out(await getClient().query(connector, params), o.format);
  });

  program.addHelpText(
    "after",
    `
Explore, then query:
  windsor connectors google                       find connector ids
  windsor accounts google_ads                     connected accounts and their ids
  windsor fields google_ads cost                  fields matching "cost"
  windsor options google_ads                      connector options for --param

Query and download:
  windsor query google_ads -F date,campaign,clicks,spend -s 90d
  windsor query google_ads -F campaign,spend -w "spend > 100 and campaign like '%brand%'"
  windsor query facebook -F date,campaign,spend -s 2026-01-01 -u 2026-03-31 -f csv > /data/fb-q1.csv
  windsor query all -F date,datasource,spend -a google_ads__123-456-7890,facebook__98765 -f jsonl
  windsor query googleanalytics4 -F date,sessions -s 7d --explain
`,
  );

  return program;
}
