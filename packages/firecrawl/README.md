# @mirage-cli/firecrawl

Wraps the published [`firecrawl-cli`](https://www.npmjs.com/package/firecrawl-cli) npm package as an importable Commander program plus a ready-made mirage CommandFn.

```sh
bun add @mirage-cli/firecrawl
```

## Usage

### As a mirage command

```ts
import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
import { firecrawlCommand } from "@mirage-cli/firecrawl";

export const fc = command({
  name: "firecrawl",
  resource: null,
  spec: new CommandSpec({
    rest: new Operand({ kind: OperandKind.TEXT }),
    description: "Firecrawl CLI",
  }),
  fn: firecrawlCommand,
});
```

### In a Cloudflare Worker

```ts
import { buildProgram } from "@mirage-cli/firecrawl";
import { streamCommander } from "@mirage-cli/core";

export default {
  async fetch(req: Request): Promise<Response> {
    const argv = await req.json() as string[];
    const program = await buildProgram();
    const { stdout, done } = streamCommander(program, argv);
    return new Response(stdout, { headers: { "content-type": "text/plain" } });
  },
};
```

### Standalone (Bun / Node)

```ts
import { runCommander } from "@mirage-cli/core";
import { buildProgram } from "@mirage-cli/firecrawl";

const program = await buildProgram();
const r = await runCommander(program, ["scrape", "https://example.com", "--formats", "markdown"]);
console.log(new TextDecoder().decode(r.stdout));
console.log("exitCode:", r.exitCode);
```

## API

| Export             | Shape                                                  | What it does                                                                   |
| ------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `buildProgram`     | `() => Promise<Command>`                               | Lazily captures + caches the firecrawl-cli `Command` instance. Async, idempotent. |
| `firecrawlCommand` | `MirageCommandFn`                                      | Drop-in for mirage's `command({ fn })`. Lazily wires up on first invocation.   |

## Env vars

| Var                       | Required | Default at import   | Notes                                                                |
| ------------------------- | -------- | ------------------- | -------------------------------------------------------------------- |
| `FIRECRAWL_API_KEY`       | Yes      | `"noop"` if unset   | Set a real key for API-call subcommands (`scrape`, `search`, etc.).  |
| `FIRECRAWL_NO_TELEMETRY`  | No       | Forced to `"1"`     | Always suppressed by this wrapper.                                   |

## How it works

`firecrawl-cli` is structurally awkward to embed: it auto-parses `process.argv` at module load via a top-level `main()` call, and exports no handle to its `program: Command`. This wrapper:

1. Resolves firecrawl-cli's nested `commander` (it bundles its own v14 separate from any commander you have installed at the top level).
2. Monkey-patches that commander's `Command.prototype.parseAsync` to capture `this` on the **first** call and short-circuit (no-op) the auto-parse.
3. Plants `process.argv = [..., "firecrawl", "--help"]` and `FIRECRAWL_API_KEY=noop` so the auto-parse takes the `parseAsync` branch (our capture point) rather than the no-args interactive auth prompt.
4. Dynamic-imports `firecrawl-cli/dist/index.js`. The captured program is cached for all subsequent calls.

The full reasoning, including why `checkCompatSource` over-reports for firecrawl-cli and what does/doesn't work in workerd, is in [`@mirage-cli/core/examples/firecrawl-compat-report.md`](../core/examples/firecrawl-compat-report.md).

## Worker compatibility matrix

| Subcommand                                                | Status      | Why                                                                |
| --------------------------------------------------------- | ----------- | ------------------------------------------------------------------ |
| `--help`, `--version`                                     | ✅ Works     | No `fs` / `child_process` calls on this path.                      |
| `scrape`, `search`, `map`, `crawl`, `parse` (read-only)   | ✅ Works     | API calls go through `@mendable/firecrawl-js` → `fetch`.           |
| `--output <file>` flags                                   | ⚠️ Will fail | Writes to local disk via `node:fs`.                                |
| `init`, `setup`, `browser`, `interact`                    | ❌ Fails     | Spawn local Chrome / write project scaffolding via `child_process`. |

## License

MIT
