# mirage-cli

A monorepo of Commander.js CLI wrappers for mirage runtimes and Cloudflare Workers.

## Layout

```
packages/
  core/         @mirage-cli/core       — the in-process CLI runner (formerly mirage-commander)
  firecrawl/    @mirage-cli/firecrawl  — wraps the published firecrawl-cli npm package
  ...           more wrappers as needed (dataforseo, ahrefs, ...)
```

Each `@mirage-cli/<vendor>` package exports two things:

- `buildProgram(): Promise<Command>` — the lazily-built Commander program. Idempotent.
- `<vendor>Command: MirageCommandFn` — a ready-made mirage CommandFn built on top of `buildProgram` + `toMirageCommandFn`. Plug straight into `command({ fn: <vendor>Command })`.

Both are tree-shakable — import only what you need.

## Tooling

- **bun workspaces** for local linking
- **changesets** for version + changelog + npm publish
- **TypeScript** with `bundler` resolution + `allowImportingTsExtensions`

Common commands:

```
bun install                # install everything
bun test                   # run every package's tests
bun typecheck              # tsc --noEmit across the monorepo
bun changeset              # author a release intent
bun release                # build + publish
```

## Adding a wrapper

1. `cp -r packages/firecrawl packages/<vendor>` and edit `package.json` + `src/index.ts`.
2. The wrapper's job is small: import the vendor's CLI, capture its `Command` (usually via `Command.prototype.parseAsync` monkey-patch if the CLI auto-parses on load), expose `buildProgram()` and `<vendor>Command`.
3. If the vendor CLI requires env vars or argv pre-conditions to import cleanly, set them in `buildProgram()` before the dynamic import. Document the env vars in the wrapper's README and in the root `.env.example`.

## Worker compatibility

The wrappers themselves are JS-only (no Node-only imports beyond `node:async_hooks` in `@mirage-cli/core` and `node:module` for CJS resolve trickery). The wrapped vendor CLIs may import `node:fs`, `node:child_process`, etc. — workerd's `nodejs_compat` stubs those at load time and only throws when actually called. So a wrapper's `--help` / `--version` / API-call subcommands typically run fine even if the vendor CLI's source scans red.

See `@mirage-cli/core/examples/firecrawl-compat-report.md` for a worked example.

## Rules

- NEVER commit `.env`. Always update `.env.example` when adding new env vars.
- NEVER hardcode credentials — wrappers read from `process.env` only.
- Use `bun` (not npm) and `bunx` (not npx).
- Use Context7 MCP for library/API documentation when relevant.
