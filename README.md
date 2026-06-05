# mirage-cli

Wrap any Commander.js TS CLI as an importable `@mirage-cli/<vendor>` package for [mirage](https://github.com/strukto-ai/mirage) runtimes and Cloudflare Workers. No subprocess, no tree introspection, no upstream forks needed in most cases — just `import { firecrawlCommand } from "@mirage-cli/firecrawl"` and register.

## Packages

| Package                    | What it is                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `@mirage-cli/core`         | The in-process runner. Streaming stdout/stderr, ByteSource stdin, ALS-isolated calls.                              |
| `@mirage-cli/firecrawl`    | Wraps the published `firecrawl-cli` npm package (scrape, crawl, map, search, …). Auto-parse interception included. |
| `dataforseo-cli`           | DataForSEO CLI source (lives in this monorepo). Exports `buildProgram()`.                                          |
| `@mirage-cli/dataforseo`   | Thin wrapper around `dataforseo-cli`'s `buildProgram` — `buildProgram` + `dataforseoCommand`.                      |
| `ahrefs-cli`               | Ahrefs API v3 CLI source (lives in this monorepo). Exports `buildProgram()`.                                       |
| `@mirage-cli/ahrefs`       | Thin wrapper around `ahrefs-cli`'s `buildProgram` — `buildProgram` + `ahrefsCommand`.                              |
| `@mirage-cli/gbp-cli`      | Google Business Profile CLI source (locations, metrics, reviews, keywords via Windsor.ai). Exports `buildProgram()`. |
| `@mirage-cli/gbp`          | Thin wrapper around `@mirage-cli/gbp-cli`'s `buildProgram` — `buildProgram` + `gbpCommand`.                        |
| `@mirage-cli/callrail-cli` | CallRail v3 CLI source — read-only call tracking (calls, summaries, trackers, SMS, forms) with multi-account profiles. |
| `@mirage-cli/callrail`     | Thin wrapper around `@mirage-cli/callrail-cli`'s `buildProgram` — `buildProgram` + `callrailCommand`.              |

**Source packages vs wrapper packages.** A `*-cli` package is the CLI itself (the binary + its programmatic API). A `@mirage-cli/<vendor>` package is the thin adapter that surfaces it as `buildProgram` + `<vendor>Command` for mirage / worker consumption.

For vendor CLIs you own, refactor them to `export function buildProgram(): Command` and the wrapper shrinks to ~15 LOC (see `@mirage-cli/dataforseo` and `@mirage-cli/ahrefs`). For third-party CLIs that auto-parse on import (firecrawl), the wrapper does a one-time `Command.prototype.parseAsync` capture (see `@mirage-cli/firecrawl`).

## Quick start

```sh
bun add @mirage-cli/dataforseo dataforseo-cli   # both wrapper and source are published
bun add @mirage-cli/ahrefs ahrefs-cli
bun add @mirage-cli/firecrawl firecrawl-cli
```

### In a mirage Workspace (recommended drop-in)

Each wrapper exports an async `<vendor>Resource()` factory that returns a mirage `Resource`. Drop it into a Workspace via `addMount` and the CLI is reachable as a general (resource-less) command — `ws.execute("dfs --version")` just works.

```ts
import { Workspace } from "@struktoai/mirage-node";
import { RAMResource } from "@struktoai/mirage-core";
import { dataforseoResource } from "@mirage-cli/dataforseo";
import { ahrefsResource } from "@mirage-cli/ahrefs";
import { firecrawlResource } from "@mirage-cli/firecrawl";

const ws = new Workspace({ "/": new RAMResource() });
ws.addMount("/cli/dfs",       await dataforseoResource());
ws.addMount("/cli/ahrefs",    await ahrefsResource());
ws.addMount("/cli/firecrawl", await firecrawlResource());

const r = await ws.execute("dfs --version");
console.log(r.exitCode, r.stdoutText); // 0  "0.3.0"
```

`<vendor>Resource()` is async because it lazy-imports `@struktoai/mirage-core` — keeps that an *optional* peer dep, so non-mirage worker consumers (just want `buildProgram`/`runCommander`) can skip it.

### Lower-level: get the Commander program directly

```ts
import { buildProgram } from "@mirage-cli/dataforseo";
import { runCommander, streamCommander } from "@mirage-cli/core";

const program = buildProgram();
const result = await runCommander(program, ["keywords", "ideas", "--seed", "shoes"]);
// → { stdout: Uint8Array, stderr: Uint8Array, exitCode: 0, error: null }
```

### In a Cloudflare Worker — stream straight to the client

```ts
import { streamCommander } from "@mirage-cli/core";
import { buildProgram } from "@mirage-cli/dataforseo";

const program = buildProgram();

export default {
  async fetch(req: Request) {
    const argv = await req.json() as string[];
    const { stdout, done } = streamCommander(program, argv);
    return new Response(stdout, { headers: { "content-type": "text/plain" } });
  }
};
```

## `--help` passthrough

Our `<vendor>Resource()` factories construct `RegisteredCommand` directly instead of going through mirage's `command()` factory. The reason: mirage's `command()` runs every spec through `withHelpSupport`, which adds a `--help` option to the spec and wraps the fn so any `--help` in argv short-circuits to a spec-based help renderer. With our minimal spec (`rest: TEXT` + a one-line description), that renderer outputs essentially nothing useful — `dfs: DataForSEO CLI` and no subcommand list.

Bypassing the factory keeps `--help` in `texts`. Our CommandFn forwards the whole argv (including `--help`) to commander, which renders its full, real help — subcommand list, options, descriptions, the works. The `RegisteredCommand` is still registered into mirage normally via the Resource's `commands()` method.

Tradeoff: we lose mirage's spec-based autocomplete (if mirage adds one later). For execute-and-render workloads — which is what these wrappers are for — that's a clean win.

## Mirage compatibility note

We target `@struktoai/mirage-core@0.0.1` (latest npm, published 2026-05-06). The [mirage repo](https://github.com/strukto-ai/mirage) has unreleased changes on `main` — the API may evolve before the next publish. When mirage cuts a new release we'll re-validate and bump the peer dep. The structural shapes we rely on (`Resource`, `CommandSpec`, `Operand`/`OperandKind`, `IOResult`, `RegisteredCommand` constructor, `MountRegistry.mount`) have been stable across versions.

A worked end-to-end example using a real `Workspace`: [`examples/mirage-workspace.ts`](./examples/mirage-workspace.ts).

## How it works

1. **`@mirage-cli/core`** patches `process.{stdout,stderr,stdin,exit}` and `console.*` once on first call, routes through `AsyncLocalStorage` per-invocation, and returns `ReadableStream`s the caller can plug straight into a `Response`. Concurrent calls in the same isolate stay isolated.

2. **Each `@mirage-cli/<vendor>` wrapper** does the minimum work needed to convert "an npm-published CLI that auto-parses on import" into "a `Command` instance you can hand to `streamCommander`." Typical shape: monkey-patch the vendor's commander prototype to capture the program on its first `parseAsync` call, plant the env vars needed to skip interactive auth, dynamic-import the CLI, cache and return.

## Development

```sh
bun install
bun test                # all packages
bun typecheck
bun changeset           # author a release intent
bun release             # build + publish
```

## License

MIT (matches upstream `mirage-commander`).
