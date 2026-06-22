# @mirage-cli/ve-fanout-cli

VE Fanout — query fan-out for AI visibility — as a Commander CLI. Submit one query and VE Fanout expands it into the sub-queries ChatGPT, Gemini (incl. AI Overviews / AI Mode), and Perplexity would generate, so you can see how AI engines decompose and interpret a search.

Wraps the [VE Fanout v1 API](https://fanout.api.viewengine.ai). Output is JSON, so it composes with `jq`.

## Auth

Pick one:

- **Headless / CI (recommended for runtimes):** set `VE_FANOUT_TOKEN` (a bearer access token). Optionally `VE_FANOUT_ORG_ID` to pin an org and `VE_FANOUT_API_URL` to point at another deployment.
- **Interactive:** `ve-fanout login` runs OAuth Authorization Code + PKCE in your browser (like `wrangler`) and caches the token under `~/.config/ve-fanout/`. Then `ve-fanout orgs use <id>`.

| Setting | Flag | Env var |
|---------|------|---------|
| Token   | `--token <jwt>` | `VE_FANOUT_TOKEN` |
| API URL | `--url <url>`   | `VE_FANOUT_API_URL` (default `https://fanout.api.viewengine.ai`) |
| Org id  | `--org <id>`    | `VE_FANOUT_ORG_ID` |

## Commands

### Queries
- `ve-fanout queries create --query <text> [--engines a,b] [--country US] [--city] [--region]` — **submit a fan-out. BILLABLE (consumes org credits).** Returns a `sessionId`; results are produced asynchronously.
- `ve-fanout queries list [--page] [--limit]` — your fan-out sessions.
- `ve-fanout queries get <sessionId>` — one session with all engine results.
- `ve-fanout queries watch <sessionId> [--interval 3] [--timeout 180]` — poll until every engine finishes.
- `ve-fanout queries regenerate <sessionId>` — **re-run all engines as a new version. BILLABLE.**
- `ve-fanout queries run-engine <sessionId> <engine>` — **re-run one engine. BILLABLE.**
- `ve-fanout queries delete <sessionId>` — **delete a session (destructive).**

### Engines, credits, status
- `ve-fanout engines list` — engines and whether they are enabled for your org.
- `ve-fanout credits` — org credit balance (default); `ve-fanout credits transactions` for history.
- `ve-fanout status` — public service health (no auth).

### Auth & orgs
- `ve-fanout login | logout | whoami`
- `ve-fanout orgs list | use <id-or-slug> | current | clear`

`login`, `logout`, and `orgs use|clear` write to `~/.config/ve-fanout` and `login` opens a browser — Node-only paths.

## Read/write boundary

Most commands read existing data. The exceptions, called out because these CLIs get wrapped for LLM drivers:

- **Billable** (consume org credits): `queries create`, `queries regenerate`, `queries run-engine`.
- **Destructive:** `queries delete`.

Gate these behind write access in read-only deployments.

## Worker compatibility

Token-based read calls are pure `fetch` and run under workerd. The auth subcommands import `node:fs` / `node:http` / `node:crypto` and lazy-load `open`; workerd stubs those at load and only throws if the auth command is actually invoked. Use `VE_FANOUT_TOKEN` in workers.

Docs: VE Fanout repo — `Handbook-Enterprises/query-fan-out` (`docs/CLI.md`, `docs/API.md`).
