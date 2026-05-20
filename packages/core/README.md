# @mirage-cli/core

Wrap any [Commander.js](https://github.com/tj/commander.js) CLI so it can be invoked in-process from a mirage-style runtime (or anywhere — e.g. a Cloudflare Worker request handler). No tree introspection, no spec rewriting, no subprocess. Just: argv in, stdout/stderr/exitCode out.

## Public API

| Export                | Shape                                                   | When to use                                                                  |
| --------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `streamCommander`     | `(program, argv, opts?) => { stdout, stderr, done }`    | Primary. Returns streams immediately; bytes flow as the action writes them.  |
| `runCommander`        | `(program, argv, opts?) => Promise<RunResult>`          | Buffered convenience — drains both streams and gives you `Uint8Array`s.      |
| `toMirageCommandFn`   | `(program) => MirageCommandFn`                          | Register a whole commander CLI as one mirage command.                        |
| `captureStdio`        | `(fn) => Promise<{ value, capture, error }>`            | Lower-level. Capture stdio from any async fn (not just commander). *Not ALS.*|
| `checkCompatSource`   | `(source: string) => CompatReport`                      | Static scan a CLI's source for CF Worker red flags. Pre-flight, approximate. |
| `formatReport`        | `(r: CompatReport) => string`                           | Pretty-print a `CompatReport` for a CLI summary.                             |

All five are exported from the package root.

## API

Two shapes for the wrapped program: **streaming** (primary) and **buffered** (convenience).

### Streaming

```ts
import { streamCommander } from "@mirage-cli/core";

const { stdout, stderr, done } = streamCommander(program, argv);
// stdout: ReadableStream<Uint8Array>  — bytes as the action writes them
// stderr: ReadableStream<Uint8Array>
// done:   Promise<{ exitCode: number; error: unknown }>

// In a Cloudflare Worker:
return new Response(stdout, { headers: { "content-type": "text/plain; charset=utf-8" } });
// The worker can return early; bytes flow to the client as the action runs.

// If you need exitCode/stderr, await done after constructing the Response.
```

### Buffered

```ts
import { runCommander } from "@mirage-cli/core";

const result = await runCommander(program, ["greet", "world", "--loud"]);
// → { stdout: Uint8Array("HELLO WORLD\n"), stderr: Uint8Array(""), exitCode: 0, error: null }
```

`runCommander` is `streamCommander` + `drain()` on both streams. Use it when you want the whole response in memory.

### Registering as a mirage command

```ts
import { command } from "@struktoai/mirage-core";
import { CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
import { toMirageCommandFn } from "@mirage-cli/core";
import { buildDfsProgram } from "dataforseo-cli";

export const dfsCommand = command({
  name: "dfs",
  resource: null,
  // Minimal spec — argv all goes through as TEXT operands. Add a richer
  // spec only if you want autocomplete; the runtime doesn't need it.
  spec: new CommandSpec({
    rest: new Operand({ kind: OperandKind.TEXT }),
    description: "DataForSEO CLI",
  }),
  fn: toMirageCommandFn(buildDfsProgram()),
});
```

`toMirageCommandFn` returns a `(accessor, paths, texts, opts) => [stdout, IOResult]` — `texts` is the argv, `opts.stdin` is the bytestream input. mirage's runtime calls it; this package handles the rest.

### What happens under the hood

On the first `streamCommander` call (lazy, idempotent):

1. `process.stdout.write`, `process.stderr.write`, `console.*`, `process.exit`, and `process.stdin` are patched **once and never restored**. Each patched function reads the active call's context out of an `AsyncLocalStorage` and routes to the right per-call writer/stdin/exit-handler.

On every call:

1. `program.exitOverride()` so commander throws on parse errors / `--help` / `--version` instead of killing the host.
2. A fresh pair of `TransformStream`s and (if you passed one) a stdin stub get wrapped into a `RunCtx`.
3. `als.run(ctx, () => program.parseAsync(argv, { from: "user" }))` runs the action inside its own ALS context. Any `console.log` / `process.stdout.write` / `process.exit` / `process.stdin` read inside the action — or inside any async hop it spawns — finds *this* call's ctx via `als.getStore()`.
4. When the action resolves (or commander throws), the writers close and `done` resolves with `{ exitCode, error }`.

`--help` and `--version` come for free — commander writes to stdout and calls `process.exit(0)`, both captured.

Outside any wrapped call, the patches fall through to the originals, so importing the module is non-invasive — `console.log` still goes to your terminal, `process.exit(1)` still kills the host.

### `captureStdio(fn)`

Lower-level: run any async function with stdio captured to buffers. Useful if you want to wrap something that isn't a commander program.

```ts
import { captureStdio } from "@mirage-cli/core";

const { value, capture, error } = await captureStdio(async () => {
  console.log("hello");
  return 42;
});
// capture.stdout: Uint8Array("hello\n")
// capture.exitCode: 0
// value: 42
```

> **Note:** `captureStdio` predates the ALS-based concurrency model and uses per-call patch/restore. It is **not** concurrency-safe — only one `captureStdio` may be in flight at a time per isolate. For commander programs use `streamCommander` / `runCommander` instead, which are.

### `checkCompatSource(source: string)`

Static scan of a CLI's source code for Cloudflare Worker red flags (`node:fs`, `child_process`, raw sockets, `eval`, `process.chdir`, `__dirname`, …). Approximate — a clean report is necessary but not sufficient; pair it with a real worker deploy + smoke test.

**Important caveat — the scanner over-reports.** Under `nodejs_compat`, workerd provides stub modules for `fs`, `child_process`, `os`, etc. that satisfy `import`/`require` at module-load time and only throw when actually called. A CLI that imports `node:fs` at the top of a file but only uses it on the `--output` flag will scan as "ERROR" but run fine for every other code path. Treat scanner errors as "this code path may break if exercised," not "this CLI won't run."

Why source-based and not program-based? Commander 12 wraps action handlers in a closure, so a built `Command` doesn't expose the user's original source to `.toString()`. Hand the scanner the actual file contents instead.

Worked examples:
- [`examples/scan-firecrawl-cli.ts`](./examples/scan-firecrawl-cli.ts) — runs the scanner against `firecrawl-cli`'s installed `dist/`.
- [`examples/wrap-firecrawl.ts`](./examples/wrap-firecrawl.ts) — **wraps the real published `firecrawl-cli` with no upstream changes** and demonstrates `--help`, `--version`, subcommand help, and unknown-command handling all working. Despite the scanner's 29 "errors," the actual CLI is wrappable in ~15 lines of glue (a `parseAsync` monkey-patch to capture the auto-instantiated program).
- [`examples/firecrawl-compat-report.md`](./examples/firecrawl-compat-report.md) — full write-up: what the scanner says, where it's wrong, what really blocks, and how to work around it.

## Constraints

- **Concurrency-safe via AsyncLocalStorage.** Globals (`process.{stdout,stderr,stdin,exit}` and `console.*`) are patched once on the first call and never restored. Each call enters its own ALS context; the patches route writes/exits to the active call's streams. Two simultaneous `streamCommander` calls in the same isolate get isolated stdout, stderr, stdin, and exit codes, as long as the wrapped action awaits its own async work (which it must do anyway to stream). Outside an active call, patches fall through to the originals, so importing the module is non-invasive. Requires `node:async_hooks` — works on Node 20+, Bun, and workerd with `nodejs_compat`.
- **Streaming requires async actions.** A sync action that writes 100 lines in a tight loop still flushes in one tick — there's no event-loop yield between writes for the consumer to pull from. If you want incremental delivery, the action must `await` between writes (e.g. awaiting `fetch()`, `setTimeout`, etc.).
- **CF Workers auto-gzip compresses streams.** When the response body is small enough to fit in one chunk before compression decides to flush, the client sees one buffered delivery. To stream end-to-end, either set `Cache-Control: no-transform`, or have the client send `Accept-Encoding: identity`. Verified behavior on `wrangler dev --local`.
- **stdin is bytestream-only.** The package builds a duck-typed `process.stdin` over the `ByteSource` you hand it (`Uint8Array | AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>`). Supports `on('data'|'end')`, `[Symbol.asyncIterator]`, `setEncoding`, `pipe`. TTY-only APIs (`isRaw`, `setRawMode`) are not implemented.
- **Worker compatibility depends on the wrapped program.** This package itself uses no Node-only APIs beyond `node:async_hooks`. If your CLI does, it'll fail at runtime regardless of how it's invoked — `checkCompatSource` is the pre-flight catch.

## Cloudflare Worker example

See [`examples/worker.ts`](./examples/worker.ts). POST `{ "argv": ["greet", "world"] }` to `/run`; the worker pipes argv into your Commander program and returns the captured stdout.

## Verified on workerd

`tests/worker-entry.ts` is a worker that exposes the package over HTTP, and `tests/drive-worker.ts` drives it. Together they verify:

- `console.log` / `process.stdout.write` capture
- `process.exit(N)` → `exitCode`
- `--help` and `--version` (commander writes to stdout, hits `exitOverride`, lands as `exitCode: 0`)
- Subcommand options + arguments
- Unknown-option parse errors (non-zero exit)
- True streaming (4 lines emitted 50ms apart arrive incrementally, not buffered)
- stdin streaming (POST body fed into the wrapped action's `process.stdin`)

`bun test` (runs against Bun, not workerd) additionally covers the concurrency guarantees: two simultaneous `streamCommander` calls don't interleave stdout, exit codes don't cross, and concurrent stdin streams route to the right call.

Run:

```
wrangler dev --port 3003 --local &
bun tests/drive-worker.ts
```

> The vitest-pool-workers path was also attempted but currently segfaults on miniflare 4.20260515.0 / workerd 1.20260515.1 when commander is imported (commander's `require('node:child_process')` at module init trips a workerd stub bug on macOS arm64 in this version). `wrangler dev` runs workerd directly and works fine — same isolate, different harness.

## Why not introspect the command tree?

Originally considered — walk the commander program, generate a mirage `CommandSpec` per subcommand, hand mirage a structured tree it could autocomplete against. Decided against it for now: if the only goal is "execute the CLI and render the output," tree introspection is dead weight. The whole CLI is one opaque argv slot from the host's perspective, and `--help` is the universal escape hatch for discovery.

If you later need autocomplete-style discovery, walking `program.commands` and reading `.options` / `.registeredArguments` is ~30 lines on top of this.
