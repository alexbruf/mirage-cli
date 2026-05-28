# @mirage-cli/radar

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

### Patch Changes

- Updated dependencies
  - @mirage-cli/radar-cli@0.2.0
