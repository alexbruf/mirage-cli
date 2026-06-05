import { Command } from "commander";
import { ApiError, CallRailClient, type ListEnvelope, type Query } from "./client.ts";
import {
  CONFIG_PATH_FOR_DISPLAY,
  fingerprint,
  getDefaultBaseUrl,
  loadFileConfig,
  mergedProfiles,
  resolveCredentials,
  saveFileConfig,
  type FileConfig,
  type ResolvedCredentials,
} from "./config.ts";
import { parseFormat, renderList, renderObject, type Format } from "./output.ts";

/**
 * Build the CallRail Commander program. Pure function — no side effects, safe
 * to call from in-process wrappers (`@mirage-cli/callrail`) or the `bin.ts`
 * entry.
 *
 * Read-only by construction: the client only speaks GET (see client.ts), so
 * every subcommand here is a read. Multi-account switching is profile-based —
 * one API key per profile, resolved per invocation with no cross-call closure
 * state (cached programs in long-lived hosts stay correct).
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name("callrail")
    .description(
      "CallRail v3 CLI — read-only call tracking data (calls, companies, trackers, " +
        "text conversations, form submissions, summaries) with multi-account profiles.",
    )
    .version("0.1.0")
    .option("--api-key <key>", "API key (or CALLRAIL_API_KEY / CALLRAIL_API_KEYS env)")
    .option("--profile <name>", "Profile to use (or CALLRAIL_PROFILE env)")
    .option("--account <id>", "CallRail account id (or CALLRAIL_ACCOUNT_ID env)")
    .option("--base-url <url>", "API base URL (or CALLRAIL_API_BASE_URL env)")
    .option("-f, --format <fmt>", "Output format: json | jsonl | table | csv", "json")
    .addHelpText(
      "after",
      `
Credentials (resolved per call):
  api key:  --api-key > CALLRAIL_API_KEY > profile (--profile > CALLRAIL_PROFILE
            > saved active profile) > sole profile
  account:  --account > CALLRAIL_ACCOUNT_ID > profile's pinned account
            > auto-detected when the key sees exactly one account
  Profiles live in ${CONFIG_PATH_FOR_DISPLAY} (managed via \`callrail auth ...\`)
  or in env: CALLRAIL_API_KEYS="name:key,name2:key2" (or a JSON object).

Examples:
  callrail auth add acme --api-key abc123          # add + verify a profile
  callrail auth use acme                           # switch active profile
  callrail calls list --date-range last_7_days --fields call_summary,sentiment
  callrail calls summary --group-by source --date-range last_30_days
  callrail calls timeseries --interval week --start-date 2026-01-01
  callrail companies list -f table
  callrail api /a.json                             # raw GET escape hatch`,
    );

  function globalOpts(): {
    apiKey?: string;
    profile?: string;
    account?: string;
    baseUrl?: string;
    format: Format;
  } {
    const opts = program.opts<{
      apiKey?: string;
      profile?: string;
      account?: string;
      baseUrl?: string;
      format?: string;
    }>();
    return { ...opts, format: parseFormat(opts.format) };
  }

  function fail(err: unknown): never {
    if (err instanceof ApiError) {
      process.stderr.write(
        JSON.stringify({ error: err.message, status: err.status, ...(err.hint ? { hint: err.hint } : {}) }) +
          "\n",
      );
    } else {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(JSON.stringify({ error: message }) + "\n");
    }
    process.exit(1);
  }

  function credentials(): ResolvedCredentials {
    const { apiKey, profile, account } = globalOpts();
    try {
      return resolveCredentials({ apiKey, profile, account });
    } catch (err) {
      fail(err);
    }
  }

  /**
   * Resolve an authenticated, account-scoped client. When no account id is
   * pinned anywhere, probe `/a.json`: exactly one visible account → use it;
   * several → structured error listing them. Stateless per invocation.
   */
  async function getClient(opts: { needsAccount?: boolean } = {}): Promise<CallRailClient> {
    const creds = credentials();
    const { baseUrl } = globalOpts();
    const base: { apiKey: string; baseUrl?: string } = {
      apiKey: creds.apiKey,
      ...(baseUrl ? { baseUrl } : {}),
    };
    if (!opts.needsAccount || creds.accountId) {
      return new CallRailClient({ ...base, ...(creds.accountId ? { accountId: creds.accountId } : {}) });
    }
    const probe = new CallRailClient(base);
    let accounts: { id: string; name?: string }[];
    try {
      ({ accounts } = await probe.get<{ accounts: { id: string; name?: string }[] }>("/a.json"));
    } catch (err) {
      fail(err);
    }
    if (accounts.length === 1 && accounts[0]) {
      return new CallRailClient({ ...base, accountId: accounts[0].id });
    }
    fail(
      new Error(
        accounts.length === 0
          ? "This API key sees no CallRail accounts."
          : `This API key sees ${accounts.length} accounts — pass --account <id>. ` +
            `Accounts: ${accounts.map((a) => `${a.id} (${a.name ?? "?"})`).join(", ")}`,
      ),
    );
  }

  function outList(envelope: ListEnvelope, collection: string): void {
    const records = (envelope[collection] as unknown[] | undefined) ?? [];
    console.log(renderList(envelope, records, globalOpts().format));
  }

  function outObject(obj: unknown): void {
    console.log(renderObject(obj, globalOpts().format));
  }

  // ── Shared list flags + pagination ──

  interface ListFlags {
    page?: string;
    perPage?: string;
    all?: boolean;
    maxRecords?: string;
    search?: string;
    sort?: string;
    order?: string;
    fields?: string;
  }

  function addListFlags(cmd: Command, opts: { fields?: boolean } = {}): Command {
    cmd
      .option("--page <n>", "Page number", "1")
      .option("--per-page <n>", "Records per page (max 250)", "100")
      .option("--all", "Fetch every page (capped by --max-records)")
      .option("--max-records <n>", "Cap for --all (respects the 1,000 req/hr limit)", "2500")
      .option("--search <term>", "Search term")
      .option("--sort <field>", "Sort field")
      .option("--order <asc|desc>", "Sort direction");
    if (opts.fields !== false) {
      cmd.option("--fields <list>", "Extra response fields, comma-separated");
    }
    return cmd;
  }

  function listQuery(flags: ListFlags, extra: Query = {}): Query {
    return {
      page: flags.page,
      per_page: flags.perPage,
      search: flags.search,
      sort: flags.sort,
      order: flags.order,
      fields: flags.fields,
      ...extra,
    };
  }

  /** Run a list call; with --all, walk pages up to --max-records. */
  async function runList(
    resource: string,
    collection: string,
    flags: ListFlags,
    extra: Query = {},
  ): Promise<void> {
    const client = await getClient({ needsAccount: resource !== "a.json" });
    const fetchPage = (query: Query): Promise<ListEnvelope> =>
      resource === "a.json"
        ? client.get<ListEnvelope>("/a.json", query)
        : client.accountGet<ListEnvelope>(resource, query);
    try {
      if (!flags.all) {
        outList(await fetchPage(listQuery(flags, extra)), collection);
        return;
      }
      const max = Number(flags.maxRecords ?? "2500");
      const records: unknown[] = [];
      let page = 1;
      let totalRecords = 0;
      let truncated = false;
      for (;;) {
        const envelope = await fetchPage(
          listQuery({ ...flags, page: String(page), perPage: "250" }, extra),
        );
        totalRecords = envelope.total_records;
        const rows = (envelope[collection] as unknown[] | undefined) ?? [];
        records.push(...rows);
        if (records.length >= max) {
          records.length = max;
          truncated = records.length < totalRecords;
          break;
        }
        if (page >= envelope.total_pages || rows.length === 0) break;
        page++;
      }
      const { format } = globalOpts();
      if (format === "json") {
        outObject({
          total_records: totalRecords,
          returned: records.length,
          ...(truncated ? { truncated: true, hint: "raise --max-records to fetch more" } : {}),
          [collection]: records,
        });
      } else {
        if (truncated) {
          process.stderr.write(
            `note: returned ${records.length} of ${totalRecords} records (--max-records cap)\n`,
          );
        }
        console.log(renderList(records, records, format));
      }
    } catch (err) {
      fail(err);
    }
  }

  async function runGet(resource: string, id: string, query: Query = {}): Promise<void> {
    const client = await getClient({ needsAccount: true });
    try {
      outObject(await client.accountGet(`${resource}/${encodeURIComponent(id)}.json`, query));
    } catch (err) {
      fail(err);
    }
  }

  // Date/segment filters shared by calls list/summary/timeseries.
  function addCallFilterFlags(cmd: Command): Command {
    return cmd
      .option(
        "--date-range <range>",
        "recent | today | yesterday | last_7_days | last_30_days | this_month | last_month | this_year | last_year | all_time",
      )
      .option("--start-date <date>", "ISO 8601 start date")
      .option("--end-date <date>", "ISO 8601 end date")
      .option("--time-zone <tz>", "IANA time zone (defaults to the account's)")
      .option("--company <id>", "Filter by company id")
      .option("--device <d>", "desktop | mobile")
      .option("--direction <d>", "inbound | outbound")
      .option("--answer-status <s>", "answered | missed | voicemail")
      .option("--lead-status <s>", "good_lead | not_a_lead | not_scored")
      .option("--tags <list>", "Comma-separated tag names");
  }

  function callFilterQuery(opts: Record<string, string | undefined>): Query {
    return {
      date_range: opts.dateRange,
      start_date: opts.startDate,
      end_date: opts.endDate,
      time_zone: opts.timeZone,
      company_id: opts.company,
      device: opts.device,
      direction: opts.direction,
      answer_status: opts.answerStatus,
      lead_status: opts.leadStatus,
      tags: opts.tags ? opts.tags.split(",").map((t) => t.trim()) : undefined,
    };
  }

  // ── auth (profiles: one API key per account) ──

  const auth = program
    .command("auth")
    .description("Manage credential profiles (one CallRail API key per profile)");

  auth
    .command("add <name>")
    .description("Add a profile (key via --api-key, CALLRAIL_API_KEY, or stdin)")
    .option("--api-key <key>", "API key for this profile")
    .option("--account <id>", "Pin an account id (skips auto-detection)")
    .option("--no-verify", "Skip the /a.json validation probe")
    .action(
      async (name: string, opts: { apiKey?: string; account?: string; verify: boolean }) => {
        // Commander binds flags that also exist program-level (--api-key,
        // --account) to the *program*, leaving the subcommand's copy empty —
        // merge both so either position works.
        const g = globalOpts();
        let apiKey = opts.apiKey ?? g.apiKey ?? process.env.CALLRAIL_API_KEY;
        if (!apiKey && !process.stdin.isTTY) {
          apiKey = (await new Response(process.stdin as unknown as ReadableStream).text()).trim();
        }
        if (!apiKey) {
          fail(
            new Error(
              "No API key. Pass --api-key <key>, set CALLRAIL_API_KEY, or pipe the key on stdin.",
            ),
          );
        }
        let accountId = opts.account ?? g.account;
        if (opts.verify) {
          const probe = new CallRailClient({ apiKey, ...(g.baseUrl ? { baseUrl: g.baseUrl } : {}) });
          let accounts: { id: string; name?: string }[];
          try {
            ({ accounts } = await probe.get<{ accounts: { id: string; name?: string }[] }>(
              "/a.json",
            ));
          } catch (err) {
            fail(err);
          }
          if (!accountId && accounts.length === 1 && accounts[0]) accountId = accounts[0].id;
          process.stderr.write(
            `verified: key sees ${accounts.length} account(s)` +
              (accountId ? `, pinned ${accountId}` : "") +
              "\n",
          );
        }
        const config: FileConfig = loadFileConfig() ?? { profiles: {} };
        config.profiles[name] = {
          apiKey,
          ...(accountId ? { accountId } : {}),
          addedAt: new Date().toISOString(),
        };
        config.activeProfile ??= name;
        saveFileConfig(config);
        outObject({
          added: name,
          apiKey: fingerprint(apiKey),
          ...(accountId ? { accountId } : {}),
          activeProfile: config.activeProfile,
        });
      },
    );

  auth
    .command("use <name>")
    .description("Set the active profile")
    .action((name: string) => {
      const config = loadFileConfig();
      if (!config || !config.profiles[name]) {
        const names = Object.keys(config?.profiles ?? {});
        fail(
          new Error(
            `Profile not found on disk: "${name}". ` +
              (names.length ? `Profiles: ${names.join(", ")}` : "Add one: callrail auth add <name>"),
          ),
        );
      }
      config.activeProfile = name;
      saveFileConfig(config);
      outObject({ activeProfile: name });
    });

  auth
    .command("list")
    .description("List profiles (disk + env) — keys shown as fingerprints only")
    .action(() => {
      const active = loadFileConfig()?.activeProfile;
      const rows = Object.entries(mergedProfiles()).map(([name, p]) => ({
        name,
        apiKey: fingerprint(p.apiKey),
        accountId: p.accountId ?? null,
        source: p.source ?? "file",
        active: name === (process.env.CALLRAIL_PROFILE ?? active),
      }));
      console.log(renderList(rows, rows, globalOpts().format));
    });

  auth
    .command("remove <name>")
    .description("Remove a profile from disk (env profiles are read-only)")
    .action((name: string) => {
      const config = loadFileConfig();
      if (!config || !config.profiles[name]) {
        fail(new Error(`Profile not found on disk: "${name}".`));
      }
      delete config.profiles[name];
      if (config.activeProfile === name) delete config.activeProfile;
      saveFileConfig(config);
      outObject({ removed: name, remaining: Object.keys(config.profiles) });
    });

  auth
    .command("whoami")
    .description("Show resolved credentials and the accounts the key can see")
    .action(async () => {
      const creds = credentials();
      const { baseUrl } = globalOpts();
      const client = new CallRailClient({ apiKey: creds.apiKey, ...(baseUrl ? { baseUrl } : {}) });
      try {
        const { accounts } = await client.get<{ accounts: unknown[] }>("/a.json");
        outObject({
          profile: creds.profile ?? null,
          source: creds.source,
          apiKey: fingerprint(creds.apiKey),
          accountId: creds.accountId ?? null,
          accounts,
        });
      } catch (err) {
        fail(err);
      }
    });

  // ── accounts ──

  const accounts = program.command("accounts").description("CallRail accounts visible to the key");

  addListFlags(accounts.command("list").description("List accounts"), { fields: false }).action(
    async (opts: ListFlags) => runList("a.json", "accounts", opts),
  );

  accounts
    .command("get [id]")
    .description("Account details (defaults to the resolved account)")
    .action(async (id: string | undefined) => {
      const client = await getClient({ needsAccount: !id });
      try {
        outObject(await client.get(`/a/${encodeURIComponent(id ?? client.accountId!)}.json`));
      } catch (err) {
        fail(err);
      }
    });

  accounts
    .command("use <id>")
    .description("Pin an account id on the active disk profile")
    .action((id: string) => {
      const config = loadFileConfig();
      const name = program.opts<{ profile?: string }>().profile ?? config?.activeProfile;
      if (!config || !name || !config.profiles[name]) {
        fail(
          new Error(
            "No disk profile to update. Add one (callrail auth add <name>) or use --account / CALLRAIL_ACCOUNT_ID.",
          ),
        );
      }
      config.profiles[name].accountId = id;
      saveFileConfig(config);
      outObject({ profile: name, accountId: id });
    });

  // ── calls (the workhorse) ──

  const calls = program.command("calls").description("Calls, summaries, and timeseries");

  addCallFilterFlags(
    addListFlags(calls.command("list").description("List calls (newest first)"))
      .option("--tracker <id>", "Filter by tracker id")
      .option(
        "--call-type <t>",
        "first_call | missed | voicemails | inbound | outbound",
      ),
  ).action(async (opts: ListFlags & Record<string, string | undefined>) =>
    runList("calls.json", "calls", opts, {
      ...callFilterQuery(opts),
      tracker_id: opts.tracker,
      call_type: opts.callType,
    }),
  );

  calls
    .command("get <id>")
    .description("Single call (use --fields for transcription, call_summary, sentiment, ...)")
    .option("--fields <list>", "Extra response fields, comma-separated")
    .action(async (id: string, opts: { fields?: string }) =>
      runGet("calls", id, { fields: opts.fields }),
    );

  addCallFilterFlags(
    calls
      .command("summary")
      .description("Aggregated call counts, grouped")
      .option(
        "--group-by <g>",
        "source | keywords | campaign | referrer | landing_page | company",
        "source",
      )
      .option("--fields <list>", "total_calls, missed_calls, answered_calls, leads, ..."),
  ).action(async (opts: Record<string, string | undefined>) => {
    const client = await getClient({ needsAccount: true });
    try {
      outObject(
        await client.accountGet("calls/summary.json", {
          ...callFilterQuery(opts),
          group_by: opts.groupBy,
          fields: opts.fields,
        }),
      );
    } catch (err) {
      fail(err);
    }
  });

  addCallFilterFlags(
    calls
      .command("timeseries")
      .description("Call counts over time (max 200 buckets)")
      .option("--interval <i>", "hour | day | week | month | year", "day")
      .option("--fields <list>", "total_calls, missed_calls, answered_calls, leads, ..."),
  ).action(async (opts: Record<string, string | undefined>) => {
    const client = await getClient({ needsAccount: true });
    try {
      outObject(
        await client.accountGet("calls/timeseries.json", {
          ...callFilterQuery(opts),
          interval: opts.interval,
          fields: opts.fields,
        }),
      );
    } catch (err) {
      fail(err);
    }
  });

  // ── simple account-scoped resources ──

  const companies = program.command("companies").description("Companies in the account");
  addListFlags(companies.command("list").description("List companies"))
    .option("--status <s>", "active | disabled")
    .action(async (opts: ListFlags & { status?: string }) =>
      runList("companies.json", "companies", opts, { status: opts.status }),
    );
  companies
    .command("get <id>")
    .description("Single company")
    .action(async (id: string) => runGet("companies", id));

  const trackers = program.command("trackers").description("Tracking phone numbers");
  addListFlags(trackers.command("list").description("List trackers"))
    .option("--status <s>", "active | disabled")
    .option("--company <id>", "Filter by company id")
    .action(async (opts: ListFlags & { status?: string; company?: string }) =>
      runList("trackers.json", "trackers", opts, {
        status: opts.status,
        company_id: opts.company,
      }),
    );
  trackers
    .command("get <id>")
    .description("Single tracker")
    .action(async (id: string) => runGet("trackers", id));

  const conversations = program
    .command("conversations")
    .description("Text message (SMS/MMS) conversations");
  addCallFilterFlags(addListFlags(conversations.command("list").description("List conversations")))
    .action(async (opts: ListFlags & Record<string, string | undefined>) =>
      runList("text-messages.json", "conversations", opts, callFilterQuery(opts)),
    );
  conversations
    .command("get <id>")
    .description("Single conversation with messages")
    .option("--fields <list>", "Extra response fields, comma-separated")
    .action(async (id: string, opts: { fields?: string }) =>
      runGet("text-messages", id, { fields: opts.fields }),
    );

  const forms = program.command("forms").description("Form submissions");
  addCallFilterFlags(addListFlags(forms.command("list").description("List form submissions")))
    .action(async (opts: ListFlags & Record<string, string | undefined>) =>
      runList("form_submissions.json", "form_submissions", opts, callFilterQuery(opts)),
    );
  forms
    .command("get <id>")
    .description("Single form submission")
    .option("--fields <list>", "Extra response fields, comma-separated")
    .action(async (id: string, opts: { fields?: string }) =>
      runGet("form_submissions", id, { fields: opts.fields }),
    );

  const users = program.command("users").description("Account users");
  addListFlags(users.command("list").description("List users"), { fields: false })
    .option("--company <id>", "Filter by company id")
    .action(async (opts: ListFlags & { company?: string }) =>
      runList("users.json", "users", opts, { company_id: opts.company }),
    );
  users
    .command("get <id>")
    .description("Single user")
    .action(async (id: string) => runGet("users", id));

  const tags = program.command("tags").description("Tags");
  addListFlags(tags.command("list").description("List tags"), { fields: false })
    .option("--company <id>", "Filter by company id")
    .option("--status <s>", "active | disabled")
    .action(async (opts: ListFlags & { company?: string; status?: string }) =>
      runList("tags.json", "tags", opts, { company_id: opts.company, status: opts.status }),
    );

  const integrations = program.command("integrations").description("Configured integrations");
  addListFlags(integrations.command("list").description("List integrations (per company)"), {
    fields: false,
  })
    .option("--company <id>", "Company id")
    .action(async (opts: ListFlags & { company?: string }) =>
      runList("integrations.json", "integrations", opts, { company_id: opts.company }),
    );

  // ── raw GET escape hatch ──

  program
    .command("api <path>")
    .description(
      "Raw GET against the v3 API (account paths may use {account} placeholder), e.g. " +
        "`callrail api /a.json` or `callrail api '/a/{account}/calls.json' -q date_range=today`",
    )
    .option("-q, --query <k=v...>", "Query params (repeatable)", (v: string, acc: string[]) => {
      acc.push(v);
      return acc;
    }, [] as string[])
    .action(async (path: string, opts: { query: string[] }) => {
      const needsAccount = path.includes("{account}");
      const client = await getClient({ needsAccount });
      const resolved = needsAccount ? path.replaceAll("{account}", client.accountId!) : path;
      const query: Query = {};
      for (const pair of opts.query) {
        const sep = pair.indexOf("=");
        if (sep <= 0) fail(new Error(`Bad query param "${pair}" — expected k=v`));
        query[pair.slice(0, sep)] = pair.slice(sep + 1);
      }
      try {
        outObject(await client.get(resolved, query));
      } catch (err) {
        fail(err);
      }
    });

  return program;
}

export { getDefaultBaseUrl };
