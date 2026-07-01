# @mirage-cli/radar-cli

## 0.2.3

### Patch Changes

- Drop the client-side `--org <slug>` resolution probe. The org-scoped V1 API now
  resolves the `X-Active-Org-Id` header by id **or** slug server-side
  (visibility-tool PR #51), so `--org` is passed through verbatim — removing the
  extra `/v1/orgs` round-trip on every `--org <slug>` call (added in 0.2.1/0.2.2
  as a workaround) and the brittle `org_`-prefix heuristic.
- Surface agency **shared projects**: `projects`/`queries`/`results`/`game-plans`
  scoped to the active org now include projects shared into it, each project row
  tagged with an `access: "owner" | "shared"` field. Docs updated; no CLI flag
  changes.

## 0.2.2

### Patch Changes

- Fix `--org <slug>` resolution (0.2.1 was broken). The 0.2.1 implementation
  cached the resolved org in closure state guarded by a one-shot flag, but
  `buildProgram()` is cached and reused across calls in long-lived hosts (e.g.
  the ve-brain worker) — so it resolved once and then ignored `--org` on every
  later call, silently falling back to the default org (a cross-call scoping
  bug). `getClient()` is now async and resolves the slug fresh per invocation
  with no shared state.

## 0.2.1

### Patch Changes

- Fix `--org <slug>`: resolve a slug to its org id before sending the
  `X-Active-Org-Id` header. The API validates that header by id, so previously
  `--org <slug>` 403'd (and the help promised "id-or-slug", matching
  `orgs use <slug>`). Resolution happens once, in a `preAction` hook, via an
  org-agnostic `/v1/orgs` lookup; `--org <org_…>` ids and the no-org path are
  unchanged (no extra request).

## 0.2.0

### Minor Changes

- Replace the radar CLI's command surface with the real org-scoped ViewEngine AI
  Visibility API (ported from `prod-ai-visibility-tool`). The package was
  previously scaffolded from `pulse-cli` and shipped the wrong (batch-jobs)
  surface.

  New surface: `projects`, `queries`, `game-plans` (incl. `update` /
  `complete-action`), `results` (query-results), `jobs` (execution-jobs, read),
  `credits`, `export <entity>`, and multi-org `orgs {list,use,current,clear}`
  (active org sent as `X-Active-Org-Id`, overridable via `--org` /
  `RADAR_ACTIVE_ORG_ID`). Removed: the old `jobs {create,download,retry,…}`,
  `models`, and `analytics` batch commands.

  Auth, config dir (`~/.config/radar`), and the `RADAR_*` env contract
  (`RADAR_API_KEY` / `RADAR_OAUTH_ACCESS_TOKEN` / `RADAR_API_BASE_URL`) are
  unchanged, so `@mirage-cli/radar` and downstream worker integrations keep
  injecting credentials exactly as before. Command name stays `radar`.
