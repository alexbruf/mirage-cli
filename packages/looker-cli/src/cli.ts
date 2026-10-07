import { Command } from "commander";
import { LookerApiError, LookerClient } from "./client.ts";

interface GlobalOptions {
  apiKey?: string;
  baseUrl?: string;
  pretty?: boolean;
}

const VERSION = "0.1.0";
const DEVICES = ["desktop", "mobile"];
const MATCH_MODES = ["domain", "url"];
const ENGINES = ["google", "bing"];
const KEYWORD_STATUSES = ["active", "won", "watch"];
const WAIT_KINDS = ["audit", "brand_visibility", "domain_overview", "keyword_research", "prompt_run", "keyword_scan"];
const GSC_DIMENSIONS = ["query", "page", "country", "device", "date", "searchAppearance"];
const GSC_RANGES = ["last_7_days", "last_28_days", "last_3_months", "last_6_months", "last_12_months", "last_16_months"];

export function buildProgram(): Command {
  const program = new Command()
    .name("looker")
    .description("looker.so rank tracker CLI: projects, tracked keywords, rank history, reports, and paid SEO research runs.")
    .version(VERSION)
    .option("--api-key <key>", "API key (or LOOKER_API_KEY)")
    .option("--base-url <url>", "Site base URL (or LOOKER_API_BASE_URL)")
    .option("--pretty", "Pretty-print JSON output")
    .addHelpText(
      "after",
      `
Environment:
  LOOKER_API_KEY        org-scoped key from Settings → API (lk_live_…)
  LOOKER_API_BASE_URL   override https://looker.so

Cost:
  Paid commands bill the org's own DataForSEO key: keywords scan|discover,
  audits run, backlinks run, brand-visibility run|rerun, keyword-research run,
  domain-overview run|rerun, prompts run, competitor-gap run. Added keywords
  (keywords add, intake) are re-checked on the project cadence, also paid.
  Everything else (lists, gets, history, report, snapshot, changes, find,
  wait, gsc) reads stored data and is free.

Examples:
  looker find sunfish
  looker projects list
  looker keywords list <project-id>
  looker keywords history <keyword-id> --days 90
  looker projects report <project-id>
  looker snapshot --project <project-id>
  looker changes --days 7
  looker keyword-research run "running shoes" --location-code 2840`,
    );

  const opts = (): GlobalOptions => program.opts<GlobalOptions>();
  const client = (): LookerClient => {
    const options = opts();
    const apiKey = options.apiKey ?? process.env.LOOKER_API_KEY;
    if (!apiKey) throw new Error("Missing API key. Set LOOKER_API_KEY or pass --api-key.");
    const baseUrl = options.baseUrl ?? process.env.LOOKER_API_BASE_URL;
    return new LookerClient({ apiKey, ...(baseUrl ? { baseUrl } : {}) });
  };
  const out = (value: unknown): void => {
    process.stdout.write(JSON.stringify(value, null, opts().pretty ? 2 : undefined) + "\n");
  };
  const run = <T extends unknown[]>(action: (...args: T) => Promise<unknown>) =>
    async (...args: T): Promise<void> => {
      try {
        out(await action(...args));
      } catch (error) {
        fail(error);
      }
    };

  // ── Lookups ──────────────────────────────────────────────────────────────
  program
    .command("find <query>")
    .description("Fuzzy-search projects, keywords and domains to resolve ids (free)")
    .option("--type <type>", "project | keyword | domain; repeat to combine", collectChoice(["project", "keyword", "domain"]), [])
    .option("--limit <n>", "Max results per type (default 10, max 25)", int)
    .action(run((query: string, o: { type: string[]; limit?: number }) =>
      client().tool("find", { query, types: o.type.length ? o.type : undefined, limit: o.limit })));

  program
    .command("locations [query]")
    .description("Resolve a place name to DataForSEO location codes (free)")
    .action(run((query?: string) => client().get("/locations", { q: query ?? "" })));

  program
    .command("snapshot")
    .description("Digest per project: positions, movers, AIO citations, stale keywords (free)")
    .option("--project <id>", "Limit to one project")
    .action(run((o: { project?: string }) => client().tool("get_seo_snapshot", { projectId: o.project })));

  program
    .command("changes")
    .description("What moved in a window: improved/declined 3+, top-10 entries/exits, AIO changes (free)")
    .option("--days <n>", "Look-back window, 1-30 (default 7)", int)
    .option("--project <id>", "Limit to one project")
    .action(run((o: { days?: number; project?: string }) =>
      client().tool("whats_changed", { sinceDays: o.days, projectId: o.project })));

  program
    .command("wait <kind> <id>")
    .description(`Long-poll a running job until done (free). kind: ${WAIT_KINDS.join(" | ")}`)
    .option("--timeout <seconds>", "Max seconds to wait (default 25, max 45)", int)
    .action(run((kind: string, id: string, o: { timeout?: number }) =>
      client().tool("wait_for", { kind: choice(kind, WAIT_KINDS, "kind"), id, timeoutSeconds: o.timeout })));

  // ── Projects ─────────────────────────────────────────────────────────────
  const projects = program.command("projects").description("Rank-tracking projects (a tracked site / report)");
  projects
    .command("list")
    .description("List active projects")
    .option("--archived", "List archived projects instead")
    .action(run((o: { archived?: boolean }) => client().get("/projects", o.archived ? { archived: 1 } : undefined)));
  projects
    .command("get <project-id>")
    .description("Get one project")
    .action(run((id: string) => client().get(`/projects/${seg(id)}`)));
  projectFields(projects.command("create").description("Create a project (write)").requiredOption("--name <name>", "Project name"))
    .action(run((o: ProjectFieldOptions & { name: string }) => client().post("/projects", projectBody(o))));
  projectFields(projects.command("update <project-id>").description("Update a project; only passed fields change (write)").option("--name <name>", "Project name"))
    .action(run((id: string, o: ProjectFieldOptions & { name?: string }) => {
      const body = projectBody(o);
      if (Object.keys(body).length === 0) throw new Error("pass at least one field to update");
      return client().patch(`/projects/${seg(id)}`, body);
    }));
  projects
    .command("archive <project-id>")
    .description("Archive a project and stop its checks; restorable (write, owner/admin key)")
    .action(run((id: string) => client().delete(`/projects/${seg(id)}`)));
  projects
    .command("restore <project-id>")
    .description("Restore an archived project (write, owner/admin key)")
    .action(run((id: string) => client().post(`/projects/${seg(id)}/unarchive`)));
  projects
    .command("report <project-id>")
    .description("Full report: summary cards plus every keyword's current rank")
    .action(run((id: string) => client().get(`/projects/${seg(id)}/report`)));
  projects
    .command("report-link <project-id>")
    .description("Create a public, shareable report URL (write, owner/admin key)")
    .action(run((id: string) => client().post(`/projects/${seg(id)}/report-link`)));

  // ── Keywords ─────────────────────────────────────────────────────────────
  const keywords = program.command("keywords").description("Tracked keywords, rank history, and live checks");
  keywords
    .command("list <project-id>")
    .description("List a project's keywords with current rank, deltas and 30-day sparkline")
    .action(run((id: string) => client().get(`/projects/${seg(id)}/keywords`)));
  keywords
    .command("add <project-id> <keyword...>")
    .description("Add keywords; each is checked now and then on the project cadence (write, paid checks)")
    .option("--domain <domain>", "Target domain (defaults to the project's)")
    .option("--match-mode <mode>", "domain | url")
    .option("--engine <engine>", "google | bing (default google)")
    .option("--location-code <code>", "DataForSEO location code", int)
    .option("--location-name <name>", "Location display name")
    .option("--language <code>", "Language code, e.g. en")
    .option("--device <device>", "desktop | mobile")
    .action(run((id: string, terms: string[], o: KeywordAddOptions) => {
      const matchMode = o.matchMode && choice(o.matchMode, MATCH_MODES, "--match-mode");
      const searchEngine = o.engine && choice(o.engine, ENGINES, "--engine");
      const device = o.device && choice(o.device, DEVICES, "--device");
      const perItem = o.locationCode !== undefined || o.locationName || o.language || device;
      const body = perItem
        ? {
          domain: o.domain,
          items: terms.map((keyword) => ({
            keyword,
            matchMode,
            searchEngine,
            locationCode: o.locationCode,
            locationName: o.locationName,
            languageCode: o.language,
            device,
          })),
        }
        : { keywords: terms, domain: o.domain, matchMode, searchEngine };
      return client().post(`/projects/${seg(id)}/keywords`, body);
    }));
  keywords
    .command("history <keyword-id>")
    .description("Rank history (every check) over a look-back window")
    .option("--days <n>", "1-365 (default 30)", int)
    .action(run((id: string, o: { days?: number }) => client().get(`/keywords/${seg(id)}/history`, { days: o.days })));
  keywords
    .command("diagnose <keyword-id>")
    .description("Why a keyword moved: trajectory, page change, AIO status, stored top 5 (free)")
    .action(run((id: string) => client().tool("diagnose_keyword", { keywordId: id })));
  keywords
    .command("scan <keyword-id>")
    .description("Run a live SERP check now (write, paid)")
    .action(run((id: string) => client().paid("POST", `/keywords/${seg(id)}/scan`)));
  keywords
    .command("status <keyword-id> <status>")
    .description("Set lifecycle status: active | won | watch (write)")
    .action(run((id: string, status: string) =>
      client().patch(`/keywords/${seg(id)}/status`, { status: choice(status, KEYWORD_STATUSES, "status") })));
  keywords
    .command("archive <keyword-id>")
    .description("Stop tracking a keyword (write, owner/admin key)")
    .action(run((id: string) => client().delete(`/keywords/${seg(id)}`)));
  keywords
    .command("discover <domain>")
    .description("Every keyword a domain ranks for; cached 24h, a fresh pull is paid (~$0.07 at 500) (write)")
    .option("--project <id>", "Flag keywords this project already tracks")
    .option("--location-code <code>", "DataForSEO location code (default 2840)", int)
    .option("--language <code>", "Language code, e.g. en")
    .option("--limit <n>", "1-1000 (default 500); cost scales with it", int)
    .option("--refresh", "Bypass the 24h cache and bill a fresh pull")
    .action(run((domain: string, o: { project?: string; locationCode?: number; language?: string; limit?: number; refresh?: boolean }) =>
      client().tool("discover_ranked_keywords", {
        domain,
        projectId: o.project,
        locationCode: o.locationCode,
        languageCode: o.language,
        limit: o.limit,
        refresh: o.refresh,
      }, { paid: true })));

  // ── Intake ───────────────────────────────────────────────────────────────
  program
    .command("intake")
    .description("Order → project + keywords + report link in one call; idempotent on --external-id (write, owner/admin key)")
    .requiredOption("--domain <domain>", "Client website")
    .requiredOption("--keyword <keyword>", "Keyword to track; repeat for more", collect, [])
    .option("--name <name>", "Project name (defaults to the domain)")
    .option("--external-id <id>", "Idempotency key, e.g. an order id")
    .option("--location-code <code>", "DataForSEO location code", int)
    .option("--location-name <name>", "Location display name")
    .option("--language <code>", "Language code")
    .option("--device <device>", "desktop | mobile")
    .option("--match-mode <mode>", "domain | url")
    .option("--frequency <days>", "Check cadence in days", int)
    .option("--no-queue-check", "Do not queue an immediate check")
    .action(run((o: IntakeOptions) => client().post("/intake", {
      domain: o.domain,
      keywords: o.keyword,
      name: o.name,
      externalId: o.externalId,
      locationCode: o.locationCode,
      locationName: o.locationName,
      languageCode: o.language,
      device: o.device && choice(o.device, DEVICES, "--device"),
      matchMode: o.matchMode && choice(o.matchMode, MATCH_MODES, "--match-mode"),
      checkFrequencyDays: o.frequency,
      queueCheck: o.queueCheck,
    })));

  // ── Paid research runs (REST) ────────────────────────────────────────────
  const audits = program.command("audits").description("Technical + on-page site audits (DataForSEO OnPage crawl)");
  audits.command("list").description("List audits, newest first").action(run(() => client().get("/audits")));
  audits
    .command("run <domain>")
    .description("Start an audit; poll with `audits get` or `wait audit <id>` (write, paid)")
    .option("--max-pages <n>", "1-250 (default 50)", int)
    .option("--project <id>", "Attach to a project")
    .action(run((target: string, o: { maxPages?: number; project?: string }) =>
      client().paid("POST", "/audits", { target, maxPages: o.maxPages, projectId: o.project })));
  audits
    .command("get <audit-id>")
    .description("Get an audit; advances a running crawl, full report once done")
    .action(run((id: string) => client().get(`/audits/${seg(id)}`)));

  const backlinks = program.command("backlinks").description("Backlink audits");
  backlinks.command("list").description("List backlink audits").action(run(() => client().get("/backlinks")));
  backlinks
    .command("run <domain>")
    .description("Run a backlink audit, about $0.11 (write, paid)")
    .action(run((domain: string) => client().paid("POST", "/backlinks", { domain })));
  backlinks.command("get <id>").description("Audit + report").action(run((id: string) => client().get(`/backlinks/${seg(id)}`)));
  shareCommand(backlinks, client, run, "/backlinks");

  const brand = program.command("brand-visibility").description("AI brand visibility (ChatGPT + AI Overviews mentions)");
  brand.command("list").description("List lookups").action(run(() => client().get("/brand-visibility")));
  brand
    .command("run <query>")
    .description("Run a lookup for a brand name or domain (write, paid)")
    .option("--competitor <domain>", "Up to 5, for share of voice; repeat", collect, [])
    .option("--location-code <code>", "DataForSEO location code", int)
    .option("--language <code>", "Language code")
    .action(run((query: string, o: { competitor: string[]; locationCode?: number; language?: string }) => {
      if (o.competitor.length > 5) throw new Error("at most 5 --competitor values");
      return client().paid("POST", "/brand-visibility", {
        query,
        competitors: o.competitor.length ? o.competitor : undefined,
        locationCode: o.locationCode,
        languageCode: o.language,
      });
    }));
  brand.command("get <id>").description("Lookup + report").action(run((id: string) => client().get(`/brand-visibility/${seg(id)}`)));
  brand
    .command("rerun <id>")
    .description("Re-run with the original inputs (write, paid)")
    .action(run((id: string) => client().paid("POST", `/brand-visibility/${seg(id)}/rerun`)));
  shareCommand(brand, client, run, "/brand-visibility");
  deleteCommand(brand, client, run, "/brand-visibility");

  const research = program.command("keyword-research").description("Seed keyword → up to 200 ideas with volume, CPC, difficulty, intent");
  research.command("list").description("List runs").action(run(() => client().get("/keyword-research")));
  research
    .command("run <seed-keyword>")
    .description("Run a research, about $0.02-$0.05 (write, paid)")
    .option("--location-code <code>", "DataForSEO location code (default 2840)", int)
    .option("--location-name <name>", "Location display name")
    .option("--language <code>", "Language code (default en)")
    .action(run((seedKeyword: string, o: MarketOptions) =>
      client().paid("POST", "/keyword-research", { seedKeyword, ...market(o) })));
  research.command("get <id>").description("Run + result table").action(run((id: string) => client().get(`/keyword-research/${seg(id)}`)));
  shareCommand(research, client, run, "/keyword-research");
  deleteCommand(research, client, run, "/keyword-research");

  const overview = program.command("domain-overview").description("Domain organic snapshot: traffic, keywords, positions, top pages, tech, Ahrefs DR");
  overview.command("list").description("List overviews").action(run(() => client().get("/domain-overview")));
  overview
    .command("run <domain>")
    .description("Run an overview, about $0.04 (write, paid)")
    .option("--location-code <code>", "DataForSEO location code (default 2840)", int)
    .option("--location-name <name>", "Location display name")
    .option("--language <code>", "Language code (default en)")
    .action(run((domain: string, o: MarketOptions) => client().paid("POST", "/domain-overview", { domain, ...market(o) })));
  overview.command("get <id>").description("Overview + report").action(run((id: string) => client().get(`/domain-overview/${seg(id)}`)));
  overview
    .command("rerun <id>")
    .description("Re-run with the original domain and market (write, paid)")
    .action(run((id: string) => client().paid("POST", `/domain-overview/${seg(id)}/rerun`)));
  shareCommand(overview, client, run, "/domain-overview");
  deleteCommand(overview, client, run, "/domain-overview");

  const prompts = program.command("prompts").description("Prompt Explorer: one prompt across ChatGPT, Claude, Gemini, Perplexity");
  prompts.command("list").description("List runs").action(run(() => client().get("/prompt-explorer")));
  prompts
    .command("run <prompt>")
    .description("Ask a prompt (max 500 chars) across four models (write, paid)")
    .option("--brand <term>", "Brand name or domain to flag as mentioned / cited")
    .action(run((prompt: string, o: { brand?: string }) => {
      if (prompt.length > 500) throw new Error("prompt must be 500 characters or fewer");
      return client().paid("POST", "/prompt-explorer", { prompt, brandTerm: o.brand });
    }));
  prompts.command("get <id>").description("Run + every model's answer and citations").action(run((id: string) => client().get(`/prompt-explorer/${seg(id)}`)));
  deleteCommand(prompts, client, run, "/prompt-explorer");

  // ── MCP-only groups ──────────────────────────────────────────────────────
  const gap = program.command("competitor-gap").description("Keywords competitors rank for that the client does not");
  gap.command("list").description("List analyses").action(run(() => client().tool("list_competitor_gaps")));
  gap
    .command("run <client-domain> <competitor-domain...>")
    .description("Run an analysis against 1-3 competitors, one paid Labs call each (write, paid)")
    .option("--location-code <code>", "DataForSEO location code (default 2840)", int)
    .option("--location-name <name>", "Location display name")
    .option("--language <code>", "Language code")
    .action(run((clientDomain: string, competitorDomains: string[], o: MarketOptions) => {
      if (competitorDomains.length > 3) throw new Error("pass 1 to 3 competitor domains");
      return client().tool("run_competitor_gap", { clientDomain, competitorDomains, ...market(o) }, { paid: true });
    }));
  gap.command("get <id>").description("Analysis + roadmap").action(run((id: string) => client().tool("get_competitor_gap", { id })));
  gap
    .command("share <id> <state>")
    .description("Turn the public share link on or off (write, owner/admin key)")
    .action(run((id: string, state: string) => client().tool("share_competitor_gap", { id, enabled: onOff(state) })));
  gap
    .command("delete <id>")
    .description("Permanently delete an analysis")
    .action(run((id: string) => client().tool("delete_competitor_gap", { id })));

  const gsc = program.command("gsc").description("Google Search Console data for projects with a linked property (free)");
  gsc.command("status").description("Connection status").action(run(() => client().tool("gsc_status")));
  gsc.command("properties").description("Verified properties on the connected Google account").action(run(() => client().tool("gsc_list_properties")));
  gsc
    .command("performance <project-id>")
    .description("Clicks, impressions, CTR, position grouped by dimensions")
    .option("--dimension <dim>", `${GSC_DIMENSIONS.join(" | ")}; repeat (max 4, default query)`, collectChoice(GSC_DIMENSIONS), [])
    .option("--range <range>", GSC_RANGES.join(" | "))
    .option("--start <date>", "YYYY-MM-DD (with --end)")
    .option("--end <date>", "YYYY-MM-DD")
    .option("--search-type <type>", "web | image | video | news | discover | googleNews")
    .option("--filter <dim:op:expr>", "AND filter, e.g. query:contains:pricing; repeat", collect, [])
    .option("--limit <n>", "Rows (default 250, max 25000)", int)
    .option("--offset <n>", "Start row", int)
    .action(run((projectId: string, o: GscOptions) => client().tool("gsc_search_performance", {
      projectId,
      dimensions: o.dimension.length ? o.dimension : undefined,
      dateRange: o.range && choice(o.range, GSC_RANGES, "--range"),
      startDate: o.start,
      endDate: o.end,
      searchType: o.searchType,
      filters: o.filter.length ? o.filter.map(parseGscFilter) : undefined,
      rowLimit: o.limit,
      startRow: o.offset,
    })));
  gsc
    .command("inspect <project-id> <url...>")
    .description("URL Inspection for 1-10 URLs (tight daily Google quota)")
    .action(run((projectId: string, urls: string[]) => {
      if (urls.length > 10) throw new Error("pass 1 to 10 URLs");
      return client().tool("gsc_inspect_urls", { projectId, urls });
    }));

  return program;
}

interface ProjectFieldOptions {
  name?: string;
  domain?: string;
  locationCode?: number;
  locationName?: string;
  language?: string;
  device?: string;
  localPack?: boolean;
  frequency?: number;
  label: string[];
}

interface KeywordAddOptions {
  domain?: string;
  matchMode?: string;
  engine?: string;
  locationCode?: number;
  locationName?: string;
  language?: string;
  device?: string;
}

interface IntakeOptions {
  domain: string;
  keyword: string[];
  name?: string;
  externalId?: string;
  locationCode?: number;
  locationName?: string;
  language?: string;
  device?: string;
  matchMode?: string;
  frequency?: number;
  queueCheck: boolean;
}

interface MarketOptions {
  locationCode?: number;
  locationName?: string;
  language?: string;
}

interface GscOptions {
  dimension: string[];
  range?: string;
  start?: string;
  end?: string;
  searchType?: string;
  filter: string[];
  limit?: number;
  offset?: number;
}

type Runner = <T extends unknown[]>(action: (...args: T) => Promise<unknown>) => (...args: T) => Promise<void>;

function projectFields(command: Command): Command {
  return command
    .option("--domain <domain>", "Default tracked domain")
    .option("--location-code <code>", "Default DataForSEO location code", int)
    .option("--location-name <name>", "Default location display name")
    .option("--language <code>", "Default language code")
    .option("--device <device>", "desktop | mobile")
    .option("--local-pack", "Include the local pack")
    .option("--frequency <days>", "Check cadence in days", int)
    .option("--label <label>", "Label; repeat for more (replaces existing on update)", collect, []);
}

function projectBody(o: ProjectFieldOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: o.name,
    defaultDomain: o.domain,
    defaultLocationCode: o.locationCode,
    defaultLocationName: o.locationName,
    defaultLanguageCode: o.language,
    defaultDevice: o.device && choice(o.device, DEVICES, "--device"),
    defaultIncludeLocalPack: o.localPack,
    defaultCheckFrequencyDays: o.frequency,
    labels: o.label.length ? o.label : undefined,
  };
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
}

function market(o: MarketOptions): Record<string, unknown> {
  return { locationCode: o.locationCode, locationName: o.locationName, languageCode: o.language };
}

function shareCommand(group: Command, client: () => LookerClient, run: Runner, base: string): void {
  group
    .command("share <id> <state>")
    .description("Turn the public share link on or off (write)")
    .action(run((id: string, state: string) => client().post(`${base}/${seg(id)}/share`, { enabled: onOff(state) })));
}

function deleteCommand(group: Command, client: () => LookerClient, run: Runner, base: string): void {
  group
    .command("delete <id>")
    .description("Permanently delete a stored run")
    .action(run((id: string) => client().delete(`${base}/${seg(id)}`)));
}

function parseGscFilter(value: string): { dimension: string; operator: string; expression: string } {
  const [dimension, operator, ...rest] = value.split(":");
  const expression = rest.join(":");
  if (!dimension || !operator || !expression) throw new Error(`--filter must be dim:op:expr, got ${JSON.stringify(value)}`);
  return { dimension: choice(dimension, GSC_DIMENSIONS, "filter dimension"), operator, expression };
}

function onOff(value: string): boolean {
  if (value === "on") return true;
  if (value === "off") return false;
  throw new Error(`state must be on or off, got ${JSON.stringify(value)}`);
}

function choice(value: string, allowed: readonly string[], label: string): string {
  if (!allowed.includes(value)) throw new Error(`${label} must be one of ${allowed.join(", ")}; got ${JSON.stringify(value)}`);
  return value;
}

function seg(id: string): string {
  if (!id.trim()) throw new Error("id cannot be empty");
  return encodeURIComponent(id.trim());
}

function int(value: string): number {
  if (!/^-?\d+$/.test(value)) throw new Error(`expected an integer, got ${JSON.stringify(value)}`);
  return Number(value);
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function collectChoice(allowed: readonly string[]) {
  return (value: string, previous: string[]): string[] => [...previous, choice(value, allowed, "value")];
}

function fail(error: unknown): never {
  if (error instanceof LookerApiError) {
    process.stderr.write(
      JSON.stringify({
        error: error.message,
        ...(error.status ? { status: error.status } : {}),
        kind: error.kind,
        ...(error.code ? { code: error.code } : {}),
        ...(error.hint ? { hint: error.hint } : {}),
        ...(error.retryAfterSeconds !== undefined ? { retry_after_seconds: error.retryAfterSeconds } : {}),
      }) + "\n",
    );
  } else {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(JSON.stringify({ error: message }) + "\n");
  }
  process.exit(1);
}
