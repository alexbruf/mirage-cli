# dataforseo-cli

Bun + TypeScript CLI **and** programmatic library wrapping the DataForSEO REST API.

## Architecture (three layers, single source of truth)

- `src/lib/{auth,client,output,spec}.ts` — primitives.
  - `auth.ts`: credentials (env vars or `~/.config/dataforseo/config.json`, basic auth).
  - `client.ts`: `fetch`-based HTTP client. Auto-wraps a single task object as `[task]` for POST endpoints. `extractItems` strips `tasks[*].result[*].items`.
  - `output.ts`: JSON / NDJSON / table / CSV / raw rendering.
  - `spec.ts`: imports `src/spec/index.json` (slim, build-time output). Powers `dfs endpoints` and `dfs raw --example`.
- `src/api/{keywords,serp,backlinks,labs,onpage,meta}.ts` — pure async functions, e.g. `keywordsSearchVolume(opts)`. The CLI commands and any programmatic caller delegate here.
- `src/framework/{types,runtime,output,index}.ts` — mirage-compatible `command()` factory.
  - `types.ts`: `CommandSpec`, `Option`, `Operand`, `OperandKind`, `IOResult`, `ParsedArgs` — same shapes as `@struktoai/mirage-browser`.
  - `runtime.ts`: `command()`, `group()`, `invoke()`, `parseArgv()`, `toCommander()`, `mountGroup()`.
  - `output.ts`: `OUTPUT_OPTIONS`, `LOC_LANG_OPTIONS`, `applyOutput()`, `locLangBody()`, `textOp()` — shared option/operand mixins so every command's flags stay consistent.
- `src/commands/{...}.ts` — one file per group. Each command is a `command({ name, spec, fn })` that calls into `src/api/`.
- `src/dfs.ts` — CLI entrypoint. Imports each group and registers via `mountGroup()` / `toCommander()`.
- `src/index.ts` — library entrypoint. Re-exports framework primitives, all `command()` definitions, all api functions, and the lib helpers.

## Build pipeline

- `scripts/build-spec-index.ts` — preprocesses `src/spec/openapi.yaml` (4.1 MiB) → `src/spec/index.json` (327 KiB) keeping only `path/method/tag/operationId/description/docUrl/example`. Runs as `prebuild`.
- `scripts/postbuild.ts` — strips bun's preserved shebang and prepends `#!/usr/bin/env node` (since we build for the node runtime).
- `scripts/build-types.ts` — runs `tsc --emitDeclarationOnly` for `dist/index.d.ts` (bun's bundler doesn't emit types).

## Conventions

- Add new commands by creating a `command({...})` in `src/commands/<group>.ts` and the matching pure async fn in `src/api/<group>.ts`. Wire it into `src/index.ts` and `src/dfs.ts`.
- Reuse `OUTPUT_OPTIONS` / `LOC_LANG_OPTIONS` so every command's output and locale flags match.
- Default output extracts items; `--full` emits the raw response. The `userCmd` overrides this since account info is most useful as a full payload.
- Don't hand-write request schemas — point users at `dfs endpoints show <path>` for the spec's example body and doc URL.

## Coverage

- 554 endpoints in the spec (across `Serp`, `KeywordsData`, `BusinessData`, `DataforseoLabs`, `AiOptimization`, `AppData`, `Merchant`, `OnPage`, `Backlinks`, `DomainAnalytics`, `ContentAnalysis`, `Appendix`).
- Curated commands cover ~30 high-traffic ones.
- Anything else is reachable via `dfs raw <path>` — the spec gates discovery and supplies example bodies.
