# @mirage-cli/ahrefs

Wraps [`ahrefs-cli`](../ahrefs-cli) as an importable Commander program plus a ready-made mirage CommandFn.

```sh
bun add @mirage-cli/ahrefs ahrefs-cli
```

## Usage

### As a mirage command

```ts
import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
import { ahrefsCommand } from "@mirage-cli/ahrefs";

export const ahrefs = command({
  name: "ahrefs",
  resource: null,
  spec: new CommandSpec({
    rest: new Operand({ kind: OperandKind.TEXT }),
    description: "Ahrefs CLI",
  }),
  fn: ahrefsCommand,
});
```

### In a Cloudflare Worker

```ts
import { streamCommander } from "@mirage-cli/core";
import { buildProgram } from "@mirage-cli/ahrefs";

const program = buildProgram();

export default {
  async fetch(req: Request): Promise<Response> {
    const argv = await req.json() as string[];
    const { stdout, done } = streamCommander(program, argv);
    return new Response(stdout, { headers: { "content-type": "text/plain" } });
  },
};
```

## API

| Export           | Shape             | What it does                                                  |
| ---------------- | ----------------- | ------------------------------------------------------------- |
| `buildProgram`   | `() => Command`   | Synchronous, idempotent. Returns the cached ahrefs program.   |
| `ahrefsCommand`  | `MirageCommandFn` | Drop-in for `command({ fn })`. Wires argv → stdout/stderr.    |

## Env vars

| Var                 | Required | Notes                                                  |
| ------------------- | -------- | ------------------------------------------------------ |
| `AHREFS_API_KEY`    | Yes      | Used by all API-call commands. Set before invoking.    |

## How it works

`ahrefs-cli` exports `buildProgram(): Command` as a pure function, so this wrapper just caches it and binds `toMirageCommandFn` once. No monkey-patching needed.

## Worker compatibility

`ahrefs-cli` is pure-fetch:

| Subcommand                                              | Status      |
| ------------------------------------------------------- | ----------- |
| `--help`, `--version`                                   | ✅ Works     |
| `keywords`, `site-explorer`, `rank-tracker`, `site-audit`, `gsc`, `account` | ✅ Works |
| `batch-analysis`                                        | ✅ Works     |

## License

MIT
