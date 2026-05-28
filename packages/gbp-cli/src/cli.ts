/**
 * gbp CLI as a commander.js program. `buildProgram()` is idempotent in the
 * sense that it has no side effects on import — there is no top-level
 * `.parseAsync()`. Every command is fetch-only (Windsor REST), so the whole
 * program is workerd-safe; the missing-key path throws rather than calling
 * `process.exit`, so it surfaces cleanly through in-process runners.
 *
 * The data layer is pluggable (`src/sources/`): Windsor backs it today, a
 * direct GBP Performance API source can drop in behind `DataSource` later.
 */
import { Command } from "commander";
import { WindsorSource } from "./sources/windsor.ts";
import type { DataSource, DateRange, QueryOpts, Row } from "./sources/types.ts";
import { render, type Format } from "./format.ts";

const VERSION = "0.1.9";

const METRIC_KEYS = [
  "impressions",
  "call_clicks",
  "website_clicks",
  "direction_requests",
  "business_bookings",
] as const;

function getSource(): DataSource {
  const apiKey = process.env.WINDSOR_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing WINDSOR_API_KEY. Set it in your environment (get a key from " +
        "https://onboard.windsor.ai/app/data-preview).",
    );
  }
  return new WindsorSource(apiKey);
}

/** Shared range/format options for data commands. */
function withRangeOpts(cmd: Command): Command {
  return cmd
    .option("-s, --since <range|date>", "30d | 12w | 6m | 1y | YYYY-MM-DD", "30d")
    .option("-u, --until <date>", "end date YYYY-MM-DD (only with a --since date)")
    .option("-f, --format <fmt>", "table | json | csv", "table")
    .option("-n, --limit <n>", "max rows");
}

/** Business-selection options. A business is required unless --all is passed. */
function withBusinessOpts(cmd: Command): Command {
  return cmd
    .option("-b, --business <name|id>", 'business to query — partial name ok, or "locations/..." id')
    .option("--all", "query every business instead of selecting one");
}

function rangeFrom(o: { since?: string; until?: string }): DateRange {
  return parseSince(o.since, o.until);
}

async function scopedOpts(source: DataSource, o: any): Promise<QueryOpts> {
  return {
    range: rangeFrom(o),
    maxRows: o.limit ? Number(o.limit) : undefined,
    business: await resolveBusiness(source, o.business, o.all),
  };
}

function parseSince(since?: string, until?: string): DateRange {
  if (!since) return { preset: "last_30d" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(since)) return { from: since, to: until };
  if (/^\d+[dwmy]$/.test(since)) return { preset: `last_${since}` };
  if (since.startsWith("last_")) return { preset: since };
  throw new Error(`Invalid --since "${since}". Use e.g. 30d, 12w, 6m, 1y, or YYYY-MM-DD.`);
}

/**
 * Resolve a user-supplied business into a concrete location id.
 * Required: errors (listing options) if neither --business nor --all is given.
 * Forgiving: matches an exact id, else a case-insensitive partial name.
 */
async function resolveBusiness(
  source: DataSource,
  business: string | undefined,
  all: boolean | undefined,
): Promise<string> {
  if (all) {
    if (business) throw new Error("Pass either --business or --all, not both.");
    return "all";
  }
  const list = await source.listBusinesses();
  const choices = () => list.map((b) => `  ${b.name}  (${b.id})`).join("\n");

  if (!business) {
    throw new Error(
      `A business is required. Pass -b <name|id> (partial name ok), or --all for every business.\n\n` +
        `Connected businesses:\n${choices()}`,
    );
  }

  const byId = list.find((b) => b.id === business);
  if (byId) return byId.id;

  const q = business.toLowerCase();
  const matches = list.filter((b) => b.name.toLowerCase().includes(q));
  if (matches.length === 1) return matches[0]!.id;
  if (matches.length === 0) {
    throw new Error(`No business matches "${business}".\n\nConnected businesses:\n${choices()}`);
  }
  throw new Error(
    `"${business}" matches multiple businesses — be more specific or use the id:\n` +
      matches.map((b) => `  ${b.name}  (${b.id})`).join("\n"),
  );
}

function aggregate(rows: Row[]): Row[] {
  const groups = new Map<string, Row>();
  for (const r of rows) {
    const key = (r.location_title as string) ?? (r.location_id as string) ?? "all";
    const g = (groups.get(key) as Record<string, number | string>) ?? {
      location_title: key,
      ...Object.fromEntries(METRIC_KEYS.map((k) => [k, 0])),
    };
    for (const k of METRIC_KEYS) (g[k] as number) += Number(r[k] ?? 0);
    groups.set(key, g);
  }
  return [...groups.values()];
}

function out(rows: Row[], format: string): void {
  console.log(render(rows, format as Format));
}

/**
 * Build a fresh, fully-configured `gbp` Commander program. No side effects on
 * import — the caller decides when to `.parseAsync()`.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name("gbp")
    .description("Query Google Business Profile data across many businesses (via Windsor.ai)")
    .version(VERSION);

  program
    .command("businesses")
    .description("List connected GBP locations")
    .option("-f, --format <fmt>", "table | json | csv", "table")
    .action(async (o: any) => {
      out(await getSource().listBusinesses(), o.format);
    });

  withRangeOpts(
    withBusinessOpts(
      program
        .command("metrics")
        .description("Performance: impressions, calls, website & direction clicks, bookings"),
    ),
  )
    .option("--total", "sum per business instead of daily rows")
    .action(async (o: any) => {
      const source = getSource();
      const rows = await source.metrics(await scopedOpts(source, o));
      out(o.total ? aggregate(rows) : rows, o.format);
    });

  withRangeOpts(
    withBusinessOpts(
      program.command("reviews").description("Reviews with ratings, text, and your replies"),
    ),
  ).action(async (o: any) => {
    const source = getSource();
    out(await source.reviews(await scopedOpts(source, o)), o.format);
  });

  withRangeOpts(
    withBusinessOpts(
      program.command("keywords").description("Search keywords people used to find each business"),
    ),
  ).action(async (o: any) => {
    const source = getSource();
    out(await source.keywords(await scopedOpts(source, o)), o.format);
  });

  withRangeOpts(
    withBusinessOpts(
      program
        .command("raw <fields>")
        .description("Request arbitrary connector fields (comma-separated; see `gbp fields`)"),
    ),
  ).action(async (fields: string, o: any) => {
    const source = getSource();
    const list = fields.split(",").map((f) => f.trim()).filter(Boolean);
    if (!list.length) throw new Error("Provide at least one field, e.g. `gbp raw date,impressions -b acme`.");
    out(await source.raw(list, await scopedOpts(source, o)), o.format);
  });

  program
    .command("fields")
    .description("List all available connector fields")
    .option("-f, --format <fmt>", "table | json | csv", "table")
    .action(async (o: any) => {
      const source = getSource();
      if (!(source instanceof WindsorSource)) throw new Error("`fields` is only supported by the Windsor backend.");
      const f = await source.listFields();
      out(f.map((x: any) => ({ id: x.id, name: x.name, type: x.type })), o.format);
    });

  program.addHelpText(
    "after",
    `
Examples:
  gbp businesses                                  list businesses (no -b needed)
  gbp metrics -b acme --since 90d --total         partial name match
  gbp metrics --all --since 30d                   every business
  gbp reviews -b "acme roofing" -s 6m -f csv > reviews.csv
  gbp keywords -b acme --since 3m
  gbp raw date,impressions_mobile_search -b acme -s 30d -f json
`,
  );

  return program;
}
