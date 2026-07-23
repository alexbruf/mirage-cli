import { Command } from "commander";
import * as auth from "./auth.ts";
import { ApiClient } from "./client.ts";
import { registerMetricsCommands } from "./commands/metrics.ts";
import { registerOrgsCommands } from "./commands/orgs.ts";
import { getDefaultBaseUrl, requireSession, type Session } from "./config.ts";

/**
 * Build the Radar Commander program. Pure function — no side effects, safe to
 * call from in-process wrappers (`@mirage-cli/radar`) or the `bin.ts` entry.
 *
 * Ported near-verbatim from the prod `ve-radar` CLI
 * (Handbook-Enterprises/prod-ai-visibility-tool `cli/ve-radar.ts`): org-scoped
 * access to the ViewEngine AI Visibility V1 API. The only adaptations are the
 * command name (`radar`, to match the in-workspace mount), the `RADAR_*`
 * credential contract (so `@mirage-cli/radar` + ve-brain inject creds via env),
 * and `buildProgram()` instead of a module-level `program.parse()`.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name("radar")
    .description("ViewEngine Radar — AI visibility CLI")
    .version("0.3.0")
    .option("--api-key <key>", "Clerk API key (or set RADAR_API_KEY env)")
    .option("--url <url>", "API base URL (or set RADAR_API_BASE_URL env)")
    .option("--org <id-or-slug>", "Override the active org for this command only");

  // Base session (creds + base URL) from the program-level flags layered over
  // the persisted/env session (`RADAR_API_KEY` / `RADAR_OAUTH_ACCESS_TOKEN`).
  // No active org applied here.
  function baseSession(): Session {
    const opts = program.opts<{ apiKey?: string; url?: string }>();
    if (opts.apiKey) {
      return {
        apiKey: opts.apiKey,
        baseUrl: opts.url ?? getDefaultBaseUrl(),
        savedAt: new Date().toISOString(),
      };
    }
    const session = requireSession();
    if (opts.url) session.baseUrl = opts.url;
    return session;
  }

  // Resolve an authenticated client. `--org` accepts an id OR a slug and is sent
  // verbatim as the `X-Active-Org-Id` header — the org-scoped V1 API resolves
  // either form server-side and normalizes to the canonical id (visibility-tool
  // PR #51), so no client-side `/v1/orgs` probe is needed. (Earlier releases
  // 0.2.1/0.2.2 resolved slugs here to work around the API validating the header
  // by id only; that workaround — and its extra round-trip on every
  // `--org <slug>` call — is now obsolete.) Kept async so long-lived hosts
  // (workers) that `await getClient()` are unaffected.
  async function getClient(): Promise<ApiClient> {
    const session = baseSession();
    // --org flag wins; otherwise the session/env active org (if any) applies.
    const org = program.opts<{ org?: string }>().org ?? session.activeOrgId;
    if (org) session.activeOrgId = org;
    return new ApiClient(session);
  }

  // Output helper — raw JSON, ideal for piping / bot consumption.
  function out(data: unknown): void {
    console.log(JSON.stringify(data, null, 2));
  }

  // ── Projects ──

  const projects = program.command("projects").description("Manage projects");

  projects
    .command("list")
    .option("--search <term>", "Search by name")
    .option("--page <n>", "Page number", "1")
    .option("--limit <n>", "Results per page", "50")
    .option("--sort <field>", "Sort by field")
    .option("--dir <asc|desc>", "Sort direction", "desc")
    .action(async (opts) => {
      out(
        await (await getClient()).list("projects", {
          search: opts.search,
          page: opts.page,
          limit: opts.limit,
          sortBy: opts.sort,
          sortDir: opts.dir,
        }),
      );
    });

  projects
    .command("get <id>")
    .action(async (id) => out(await (await getClient()).get("projects", id)));

  // ── Queries ──

  const queries = program.command("queries").description("Manage queries");

  queries
    .command("list")
    .option("--search <term>", "Search query text")
    .option("--category <cat>", "Filter by category")
    .option("--project-id <id>", "Filter by project")
    .option("--page <n>", "Page number", "1")
    .option("--limit <n>", "Results per page", "50")
    .option("--sort <field>", "Sort by field")
    .option("--dir <asc|desc>", "Sort direction", "desc")
    .action(async (opts) => {
      out(
        await (await getClient()).list("queries", {
          search: opts.search,
          category: opts.category,
          projectId: opts.projectId,
          page: opts.page,
          limit: opts.limit,
          sortBy: opts.sort,
          sortDir: opts.dir,
        }),
      );
    });

  // ── Game Plans ──

  const gamePlans = program.command("game-plans").description("Manage game plans");

  gamePlans
    .command("list")
    .option("--status <s>", "Filter by status")
    .option("--search <term>", "Search by query text")
    .option("--page <n>", "Page number", "1")
    .option("--limit <n>", "Results per page", "50")
    .option("--sort <field>", "Sort by field")
    .option("--dir <asc|desc>", "Sort direction", "desc")
    .action(async (opts) => {
      out(
        await (await getClient()).list("game-plans", {
          status: opts.status,
          search: opts.search,
          page: opts.page,
          limit: opts.limit,
          sortBy: opts.sort,
          sortDir: opts.dir,
        }),
      );
    });

  gamePlans
    .command("get <id>")
    .action(async (id) => out(await (await getClient()).get("game-plans", id)));

  gamePlans
    .command("update <id>")
    .option("--status <s>", "Set status")
    .option("--actions <json>", "Replace actions array (JSON string)")
    .action(async (id, opts) => {
      const body: Record<string, unknown> = {};
      if (opts.status) body.status = opts.status;
      if (opts.actions) body.actions = JSON.parse(opts.actions);
      out(await (await getClient()).patch("game-plans", id, body));
    });

  gamePlans
    .command("complete-action <planId> <actionIndex>")
    .description("Mark an action as completed")
    .action(async (planId, indexStr) => {
      const client = await getClient();
      const plan = await client.get<{ actions: Record<string, unknown>[] }>("game-plans", planId);
      const idx = Number(indexStr);
      const action = Number.isInteger(idx) ? plan.actions[idx] : undefined;
      if (!action) {
        console.error(`Action index ${indexStr} out of range (0-${plan.actions.length - 1})`);
        process.exit(1);
      }
      action.completed = true;
      out(await client.patch("game-plans", planId, { actions: plan.actions }));
    });

  // ── Query Results ──

  const results = program.command("results").description("View query results");

  results
    .command("list")
    .option("--provider <p>", "Filter by provider")
    .option("--query-id <id>", "Filter by query ID")
    .option("--page <n>", "Page number", "1")
    .option("--limit <n>", "Results per page", "50")
    .option("--sort <field>", "Sort by field")
    .option("--dir <asc|desc>", "Sort direction", "desc")
    .action(async (opts) => {
      out(
        await (await getClient()).list("query-results", {
          provider: opts.provider,
          queryId: opts.queryId,
          page: opts.page,
          limit: opts.limit,
          sortBy: opts.sort,
          sortDir: opts.dir,
        }),
      );
    });

  results
    .command("get <id>")
    .description("Get full result detail (includes response text, citations)")
    .action(async (id) => out(await (await getClient()).get("query-results", id)));

  // ── Execution Jobs ──

  const jobs = program.command("jobs").description("View execution jobs");

  jobs
    .command("list")
    .option("--status <s>", "Filter by status")
    .option("--page <n>", "Page number", "1")
    .option("--limit <n>", "Results per page", "50")
    .option("--sort <field>", "Sort by field")
    .option("--dir <asc|desc>", "Sort direction", "desc")
    .action(async (opts) => {
      out(
        await (await getClient()).list("execution-jobs", {
          status: opts.status,
          page: opts.page,
          limit: opts.limit,
          sortBy: opts.sort,
          sortDir: opts.dir,
        }),
      );
    });

  // ── Credits ──

  const credits = program.command("credits").description("View credit transactions");

  credits
    .command("list")
    .option("--type <t>", "Filter by type (credit/debit/purchase/refund/usage)")
    .option("--page <n>", "Page number", "1")
    .option("--limit <n>", "Results per page", "50")
    .option("--sort <field>", "Sort by field")
    .option("--dir <asc|desc>", "Sort direction", "desc")
    .action(async (opts) => {
      out(
        await (await getClient()).list("credits", {
          type: opts.type,
          page: opts.page,
          limit: opts.limit,
          sortBy: opts.sort,
          sortDir: opts.dir,
        }),
      );
    });

  // ── Export ──

  program
    .command("export <entity>")
    .description(
      "Export all rows as JSON (projects, queries, game-plans, query-results, execution-jobs, credits)",
    )
    .option("--status <s>", "Filter by status")
    .option("--provider <p>", "Filter by provider")
    .option("--search <term>", "Search filter")
    .action(async (entity, opts) => {
      const client = await getClient();
      const allRows: unknown[] = [];
      let page = 1;
      for (;;) {
        const data = await client.list(entity, {
          status: opts.status,
          provider: opts.provider,
          search: opts.search,
          page: String(page),
          limit: "100",
        });
        allRows.push(...data.rows);
        if (allRows.length >= data.total || data.rows.length === 0) break;
        page++;
      }
      out({ total: allRows.length, rows: allRows });
    });

  // ── Auth (login / whoami / logout) ──
  //
  // Kept on the existing `RADAR_*` Clerk OAuth + API-key plumbing so the
  // `@mirage-cli/radar` wrapper and ve-brain's env injection work unchanged.

  program
    .command("login")
    .description("Login via Clerk OAuth (browser) or --api-key for headless/CI")
    .option("--api-key <key>", "Clerk API key (skips the OAuth browser flow)")
    .option("--base-url <url>", "Override API base URL")
    .action(async (opts: { apiKey?: string; baseUrl?: string }) => {
      if (opts.apiKey) await auth.loginWithApiKey(opts.apiKey, opts.baseUrl);
      else await auth.loginWithOAuth(opts.baseUrl);
    });

  program
    .command("whoami")
    .description("Show current session")
    .action(async () => auth.whoami());

  program
    .command("logout")
    .description("Clear saved session")
    .action(() => auth.logout());

  // ── Orgs (multi-tenant switch) ──
  registerOrgsCommands(program, getClient);
  registerMetricsCommands(program, getClient);

  return program;
}
