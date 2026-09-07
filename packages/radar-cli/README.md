# @mirage-cli/radar-cli

ViewEngine Radar CLI — org-scoped access to the ViewEngine AI Visibility API at
`radar.viewengine.ai`. Create and onboard projects; read queries, query-results,
execution-jobs, and credits; manage game plans; switch between organizations.

```
bun add -g @mirage-cli/radar-cli
radar login                    # Clerk OAuth (browser)
radar login --api-key sk_...   # headless / CI

radar orgs list                # orgs you belong to
radar orgs use <id-or-slug>    # set the active org (persisted)

radar projects list --search acme
radar projects create example.com
radar onboarding analyze <projectId> --domain example.com --verbose
radar onboarding save <projectId> --section business --data @business.json
radar onboarding generate-queries <projectId> --profile @profile.json
radar onboarding complete <projectId> --queries @queries.json
radar queries list --project-id <id>
radar game-plans list --status open
radar game-plans complete-action <planId> <actionIndex>
radar results list --provider perplexity --query-id <id>
radar jobs list --status running
radar credits list
radar export game-plans > game-plans.json
```

## Commands

- `projects {create, list, get}` — creation uses the onboarding-aware route;
  renaming and descriptions remain a separate concern until that dashboard
  update contract is represented in this repo
- `onboarding {create, status, analyze, save, generate-queries, complete}` —
  headless project setup; JSON options accept inline JSON or `@file`, and the
  two SSE commands buffer output until completion (`--timeout`, `--verbose`)
- `queries {list}`
- `game-plans {list, get, update, complete-action}`
- `results {list, get}` (query-results)
- `jobs {list}` (execution-jobs)
- `credits {list}`
- `export <entity>` — page through every row of an entity
- `metrics {overview, project, brands, sources, trends, heatmap}` — server-side
  aggregates (dashboard-identical numbers); `--days/--from/--until/--platforms`
  windowing, `--format table|csv|json`, `overview --compare` for
  period-over-period deltas
- `export-results` — full-history NDJSON streamed server-side (`--since` resume,
  `-o <file>`)
- `orgs {list, use, current, clear}` — multi-tenant switching
- `login / whoami / logout`

All list commands accept `--page`, `--limit`, `--sort <field>`, `--dir <asc|desc>`.
Output is JSON (ideal for piping / bot consumption).

## Auth & org scoping

- `radar login` — Clerk OAuth (PKCE + RFC 7591 DCR + loopback). Persists to `~/.config/radar/session.json` (0600).
- `radar login --api-key sk_...` — Clerk machine API key for headless use.
- Env override: `RADAR_API_KEY` (preferred) or `RADAR_OAUTH_ACCESS_TOKEN`. `RADAR_API_BASE_URL` overrides the base URL.
- Active org: `radar orgs use <id-or-slug>` persists it; override per-command with `--org <id-or-slug>` or the `RADAR_ACTIVE_ORG_ID` env var. It rides on every request as the `X-Active-Org-Id` header, which the API resolves by **id or slug** server-side.
- Shared projects: `projects`, `queries`, `results`, and `game-plans` scoped to the active org include projects **shared into** it (agency access), not just ones it owns. Each project row carries an `access` field — `"owner"` (your org owns/pays) or `"shared"` (shared in for view/run/edit; billing hidden). Jobs and credits stay owner-org-only.

## Programmatic use

```ts
import { buildProgram, ApiClient, loadSession } from "@mirage-cli/radar-cli";

// As a Commander program (drives the same CLI surface):
const program = buildProgram();
await program.parseAsync(["node", "radar", "projects", "list"]);

// As a typed API client:
const session = loadSession();
if (session) {
  const client = new ApiClient(session);
  const { rows, total } = await client.list("projects", { search: "acme" });
  const plan = await client.get("game-plans", "<id>");
}
```

Drop-in for mirage: see `@mirage-cli/radar`.
