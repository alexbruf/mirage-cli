import { Command } from "commander";
import { ApiError, HubSpotClient, type ListEnvelope, type Query } from "./client.ts";
import {
  HS_CONFIG_PATH_FOR_DISPLAY,
  getDefaultBaseUrl,
  loadHsConfig,
  resolveAuth,
  type ResolvedAuth,
} from "./config.ts";
import { parseFormat, renderList, renderObject, type Format } from "./output.ts";

/**
 * Build the HubSpot Commander program. Pure function — no side effects, safe
 * to call from in-process wrappers (`@mirage-cli/hubspot`) or the `bin.ts`
 * entry.
 *
 * Read-only by construction: the client only speaks GET + the read-only search
 * POST (see client.ts), so every subcommand here is a read. The grammar mirrors
 * the official `hs` CLI (`hubspot <noun> <verb> --account <name>`) and reuses
 * its `~/.hscli/config.yml` login, so there's no new auth to learn.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name("hubspot")
    .description(
      "HubSpot CLI — read-only access to CRM (contacts, companies, deals, tickets, custom " +
        "objects), marketing (forms, emails, campaigns), and CMS (blog, pages, HubDB). " +
        "hs-style grammar; reuses your `hs account auth` login.",
    )
    .version("0.1.0")
    .option("--token <token>", "Access token: private app or OAuth (or HUBSPOT_ACCESS_TOKEN env)")
    .option("-a, --account <name|id>", "Account from ~/.hscli/config.yml (or HUBSPOT_ACCOUNT_ID env)")
    .option("--base-url <url>", "API base URL (or HUBSPOT_API_BASE_URL env)")
    .option("-f, --format <fmt>", "Output format: json | jsonl | table | csv", "json")
    .addHelpText(
      "after",
      `
Credentials (resolved per call, in order):
  1. --token / HUBSPOT_ACCESS_TOKEN            private app token or any access token
  2. HUBSPOT_PERSONAL_ACCESS_KEY (+ HUBSPOT_ACCOUNT_ID)   exchanged for a token
  3. ~/.hscli/config.yml account (--account <name|id> or its default)
     ${HS_CONFIG_PATH_FOR_DISPLAY} — populated by \`hs account auth\`

Examples:
  hubspot account whoami
  hubspot crm contacts list --properties email,firstname,lastname -f table
  hubspot crm contacts search --query acme --limit 50
  hubspot crm deals list --all --max-records 5000 --properties dealname,amount,dealstage
  hubspot crm object list p_custom                 # any object, incl. custom
  hubspot crm properties contacts
  hubspot marketing forms list
  hubspot cms blog-posts list --limit 20
  hubspot api /crm/v3/objects/companies -q limit=5  # raw GET escape hatch`,
    );

  function globalOpts(): {
    token?: string;
    account?: string;
    baseUrl?: string;
    format: Format;
  } {
    const opts = program.opts<{
      token?: string;
      account?: string;
      baseUrl?: string;
      format?: string;
    }>();
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

  async function auth(): Promise<ResolvedAuth> {
    const { token, account, baseUrl } = globalOpts();
    try {
      return await resolveAuth({ token, account, baseUrl });
    } catch (err) {
      return fail(err);
    }
  }

  async function getClient(): Promise<HubSpotClient> {
    const { baseUrl } = globalOpts();
    const resolved = await auth();
    return new HubSpotClient({
      token: resolved.tokenProvider,
      ...(baseUrl ? { baseUrl } : {}),
    });
  }

  function outList(envelope: ListEnvelope): void {
    console.log(renderList(envelope, envelope.results ?? [], globalOpts().format));
  }

  function outObject(obj: unknown): void {
    console.log(renderObject(obj, globalOpts().format));
  }

  // ── shared list flags + cursor pagination ──

  interface ListFlags {
    limit?: string;
    after?: string;
    all?: boolean;
    maxRecords?: string;
    properties?: string;
    associations?: string;
    archived?: boolean;
  }

  function addListFlags(cmd: Command, opts: { crm?: boolean } = {}): Command {
    cmd
      .option("--limit <n>", "Page size (max 100 for CRM objects)", "100")
      .option("--after <cursor>", "Pagination cursor (paging.next.after)")
      .option("--all", "Fetch every page (capped by --max-records)")
      .option("--max-records <n>", "Cap for --all", "1000");
    if (opts.crm !== false) {
      cmd
        .option("--properties <list>", "Comma-separated properties to return")
        .option("--associations <list>", "Comma-separated object types to fetch association ids for")
        .option("--archived", "Return archived records instead of active");
    }
    return cmd;
  }

  function listQuery(flags: ListFlags, extra: Query = {}): Query {
    return {
      limit: flags.limit,
      after: flags.after,
      properties: flags.properties ? flags.properties.split(",").map((p) => p.trim()) : undefined,
      associations: flags.associations
        ? flags.associations.split(",").map((p) => p.trim())
        : undefined,
      archived: flags.archived ? "true" : undefined,
      ...extra,
    };
  }

  /** GET a collection; with --all, walk `paging.next.after` up to --max-records. */
  async function runList(path: string, flags: ListFlags, extra: Query = {}): Promise<void> {
    const client = await getClient();
    try {
      if (!flags.all) {
        outList(await client.get<ListEnvelope>(path, listQuery(flags, extra)));
        return;
      }
      const max = Number(flags.maxRecords ?? "1000");
      const results: unknown[] = [];
      let after: string | undefined = flags.after;
      let truncated = false;
      for (;;) {
        const envelope: ListEnvelope = await client.get<ListEnvelope>(
          path,
          listQuery({ ...flags, after, limit: "100" }, extra),
        );
        results.push(...(envelope.results ?? []));
        after = envelope.paging?.next?.after;
        if (results.length >= max) {
          truncated = results.length > max || Boolean(after);
          results.length = Math.min(results.length, max);
          break;
        }
        if (!after) break;
      }
      const { format } = globalOpts();
      if (format === "json") {
        outObject({
          returned: results.length,
          ...(truncated ? { truncated: true, hint: "raise --max-records to fetch more" } : {}),
          results,
        });
      } else {
        if (truncated) {
          process.stderr.write(`note: returned ${results.length} records (--max-records cap)\n`);
        }
        console.log(renderList({ results }, results, format));
      }
    } catch (err) {
      fail(err);
    }
  }

  async function runGet(path: string, query: Query = {}): Promise<void> {
    const client = await getClient();
    try {
      outObject(await client.get(path, query));
    } catch (err) {
      fail(err);
    }
  }

  // ── CRM object commands (generic; one factory per object type) ──

  /**
   * Register `list`, `get <id>`, and `search` on `parent` for a CRM object
   * type. Every CRM object — standard or custom — shares this exact shape
   * (`/crm/v3/objects/{type}`), so the whole CRM read surface is this factory.
   */
  function addObjectCommands(parent: Command, objectType: string): void {
    addListFlags(parent.command("list").description(`List ${objectType}`)).action(
      async (opts: ListFlags) => runList(`/crm/v3/objects/${objectType}`, opts),
    );

    parent
      .command("get <id>")
      .description(`Single ${objectType} record by id`)
      .option("--properties <list>", "Comma-separated properties to return")
      .option("--associations <list>", "Comma-separated object types to fetch association ids for")
      .option("--archived", "Look up an archived record")
      .option("--id-property <name>", "Treat <id> as this unique property instead of the record id")
      .action(
        async (
          id: string,
          opts: { properties?: string; associations?: string; archived?: boolean; idProperty?: string },
        ) =>
          runGet(`/crm/v3/objects/${objectType}/${encodeURIComponent(id)}`, {
            properties: opts.properties ? opts.properties.split(",").map((p) => p.trim()) : undefined,
            associations: opts.associations
              ? opts.associations.split(",").map((p) => p.trim())
              : undefined,
            archived: opts.archived ? "true" : undefined,
            idProperty: opts.idProperty,
          }),
      );

    parent
      .command("search")
      .description(`Search ${objectType} (read-only POST /search)`)
      .option("--query <text>", "Full-text query across default searchable properties")
      .option(
        "--filter <prop=value...>",
        "EQ filter, repeatable (ANDed), e.g. --filter lifecyclestage=customer",
        (v: string, acc: string[]) => {
          acc.push(v);
          return acc;
        },
        [] as string[],
      )
      .option("--properties <list>", "Comma-separated properties to return")
      .option("--sort <prop>", "Sort property")
      .option("--order <asc|desc>", "Sort direction", "DESCENDING")
      .option("--limit <n>", "Page size (max 200)", "100")
      .option("--after <cursor>", "Pagination cursor")
      .action(
        async (opts: {
          query?: string;
          filter: string[];
          properties?: string;
          sort?: string;
          order?: string;
          limit?: string;
          after?: string;
        }) => {
          const filters = opts.filter.map((f) => {
            const sep = f.indexOf("=");
            if (sep <= 0) fail(new Error(`Bad --filter "${f}" — expected prop=value`));
            return { propertyName: f.slice(0, sep), operator: "EQ", value: f.slice(sep + 1) };
          });
          const order = (opts.order ?? "DESCENDING").toUpperCase().startsWith("A")
            ? "ASCENDING"
            : "DESCENDING";
          const body: Record<string, unknown> = {
            ...(opts.query ? { query: opts.query } : {}),
            ...(filters.length ? { filterGroups: [{ filters }] } : {}),
            ...(opts.properties
              ? { properties: opts.properties.split(",").map((p) => p.trim()) }
              : {}),
            ...(opts.sort ? { sorts: [{ propertyName: opts.sort, direction: order }] } : {}),
            limit: Number(opts.limit ?? "100"),
            ...(opts.after ? { after: opts.after } : {}),
          };
          const client = await getClient();
          try {
            outList(await client.search<ListEnvelope>(`/crm/v3/objects/${objectType}/search`, body));
          } catch (err) {
            fail(err);
          }
        },
      );
  }

  const crm = program.command("crm").description("CRM objects, properties, owners, pipelines, associations");

  // Friendly subcommands for the standard objects…
  const STANDARD_OBJECTS: Record<string, string> = {
    contacts: "contacts",
    companies: "companies",
    deals: "deals",
    tickets: "tickets",
    products: "products",
    "line-items": "line_items",
    quotes: "quotes",
    calls: "calls",
    emails: "emails",
    meetings: "meetings",
    notes: "notes",
    tasks: "tasks",
  };
  for (const [name, objectType] of Object.entries(STANDARD_OBJECTS)) {
    addObjectCommands(
      crm.command(name).description(`${name} (CRM object ${objectType})`),
      objectType,
    );
  }

  // …and a generic `object <type> …` for custom objects and anything else.
  // <type> is the subcommand's own argument (robust commander parsing).
  const objectGroup = crm
    .command("object")
    .description("Any CRM object by type/objectTypeId (e.g. a custom object like p_pets)");
  addListFlags(
    objectGroup.command("list <type>").description("List records of <type>"),
  ).action(async (type: string, opts: ListFlags) =>
    runList(`/crm/v3/objects/${encodeURIComponent(type)}`, opts),
  );
  objectGroup
    .command("get <type> <id>")
    .description("Single record of <type> by id")
    .option("--properties <list>", "Comma-separated properties to return")
    .action(async (type: string, id: string, opts: { properties?: string }) =>
      runGet(`/crm/v3/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, {
        properties: opts.properties ? opts.properties.split(",").map((p) => p.trim()) : undefined,
      }),
    );

  crm
    .command("properties <objectType>")
    .description("List the property definitions for an object type")
    .action(async (objectType: string) =>
      runList(`/crm/v3/properties/${encodeURIComponent(objectType)}`, {}),
    );

  addListFlags(
    crm.command("owners").description("List CRM owners (users records can be assigned to)"),
    { crm: false },
  )
    .option("--email <email>", "Filter by email")
    .action(async (opts: { email?: string } & ListFlags) =>
      runList("/crm/v3/owners", opts, { email: opts.email }),
    );

  crm
    .command("pipelines <objectType>")
    .description("List pipelines for an object type (e.g. deals, tickets)")
    .action(async (objectType: string) =>
      runList(`/crm/v3/pipelines/${encodeURIComponent(objectType)}`, {}),
    );

  crm
    .command("associations <fromType> <id> <toType>")
    .description("List associated <toType> ids for a <fromType> record")
    .action(async (fromType: string, id: string, toType: string) =>
      runList(
        `/crm/v4/objects/${encodeURIComponent(fromType)}/${encodeURIComponent(id)}/associations/${encodeURIComponent(toType)}`,
        {},
      ),
    );

  // ── marketing ──

  const marketing = program.command("marketing").description("Marketing: forms, emails, campaigns");
  addListFlags(marketing.command("forms").description("List marketing forms"), { crm: false }).action(
    async (opts: ListFlags) => runList("/marketing/v3/forms", opts),
  );
  addListFlags(marketing.command("emails").description("List marketing emails"), {
    crm: false,
  }).action(async (opts: ListFlags) => runList("/marketing/v3/emails", opts));
  addListFlags(marketing.command("campaigns").description("List marketing campaigns"), {
    crm: false,
  }).action(async (opts: ListFlags) => runList("/marketing/v3/campaigns", opts));

  // ── cms (blog, pages, hubdb) ──

  const cms = program.command("cms").description("CMS: blog posts/authors/tags, site pages, HubDB");
  addListFlags(cms.command("blog-posts").description("List blog posts"), { crm: false }).action(
    async (opts: ListFlags) => runList("/cms/v3/blogs/posts", opts),
  );
  addListFlags(cms.command("blog-authors").description("List blog authors"), { crm: false }).action(
    async (opts: ListFlags) => runList("/cms/v3/blogs/authors", opts),
  );
  addListFlags(cms.command("blog-tags").description("List blog tags"), { crm: false }).action(
    async (opts: ListFlags) => runList("/cms/v3/blogs/tags", opts),
  );
  addListFlags(cms.command("pages").description("List site pages"), { crm: false }).action(
    async (opts: ListFlags) => runList("/cms/v3/pages/site-pages", opts),
  );
  const hubdb = cms.command("hubdb").description("HubDB tables and rows");
  addListFlags(hubdb.command("tables").description("List HubDB tables"), { crm: false }).action(
    async (opts: ListFlags) => runList("/cms/v3/hubdb/tables", opts),
  );
  addListFlags(
    hubdb.command("rows <tableIdOrName>").description("List rows of a HubDB table"),
    { crm: false },
  ).action(async (tableIdOrName: string, opts: ListFlags) =>
    runList(`/cms/v3/hubdb/tables/${encodeURIComponent(tableIdOrName)}/rows`, opts),
  );

  // ── account ──

  const account = program.command("account").description("Account info and resolved credentials");

  account
    .command("whoami")
    .description("Show the resolved credential source and the account it authenticates")
    .action(async () => {
      const resolved = await auth();
      const client = await getClient();
      try {
        const details = await client.get("/account-info/v3/details");
        outObject({
          source: resolved.source,
          ...(resolved.account ? { account: resolved.account } : {}),
          ...(resolved.portalId ? { portalId: resolved.portalId } : {}),
          details,
        });
      } catch (err) {
        fail(err);
      }
    });

  account
    .command("list")
    .description("List HubSpot accounts found in ~/.hscli/config.yml")
    .action(async () => {
      const config = await loadHsConfig();
      const rows = (config?.accounts ?? []).map((a) => ({
        name: a.name ?? null,
        accountId: a.accountId ?? null,
        hasPersonalAccessKey: Boolean(a.personalAccessKey),
        default: String(config?.defaultAccount ?? "") === (a.name ?? String(a.accountId)),
      }));
      console.log(renderList({ results: rows }, rows, globalOpts().format));
    });

  // ── raw GET escape hatch (covers every read endpoint we didn't model) ──

  program
    .command("api <path>")
    .description(
      "Raw GET against any HubSpot API path, e.g. " +
        "`hubspot api /crm/v3/objects/contacts -q limit=5 -q properties=email`",
    )
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
      const client = await getClient();
      try {
        outObject(await client.get(path, query));
      } catch (err) {
        fail(err);
      }
    });

  return program;
}

export { getDefaultBaseUrl };
