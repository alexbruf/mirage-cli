# @mirage-cli/dataforseo

Wraps [`dataforseo-cli`](../dataforseo-cli) as an importable Commander program plus a ready-made mirage CommandFn.

```sh
bun add @mirage-cli/dataforseo dataforseo-cli
```

## Usage

### As a mirage command

```ts
import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
import { dataforseoCommand } from "@mirage-cli/dataforseo";

export const dfs = command({
  name: "dfs",
  resource: null,
  spec: new CommandSpec({
    rest: new Operand({ kind: OperandKind.TEXT }),
    description: "DataForSEO CLI",
  }),
  fn: dataforseoCommand,
});
```

### In a Cloudflare Worker

```ts
import { streamCommander } from "@mirage-cli/core";
import { buildProgram } from "@mirage-cli/dataforseo";

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

| Export             | Shape                  | What it does                                                  |
| ------------------ | ---------------------- | ------------------------------------------------------------- |
| `buildProgram`     | `() => Command`        | Synchronous, idempotent. Returns the cached dfs program.      |
| `dataforseoCommand` | `MirageCommandFn`     | Drop-in for `command({ fn })`. Wires argv → stdout/stderr.    |

## Env vars

| Var                    | Required for                            | Notes                                                                |
| ---------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| `DATAFORSEO_USERNAME`  | All API-call commands                   | Basic auth username.                                                 |
| `DATAFORSEO_PASSWORD`  | All API-call commands                   | Basic auth password.                                                 |

`dataforseo-cli` also reads `~/.config/dataforseo/config.json` if it exists — fine in Bun/Node, unavailable in workers. Use env vars in worker deploys.

## How it works

Trivial — `dataforseo-cli` exports `buildProgram(): Command` as a pure function, so this wrapper just caches it and binds `toMirageCommandFn` once. No monkey-patching needed (compare with [@mirage-cli/firecrawl](../firecrawl/) which has to intercept the auto-parse).

## Worker compatibility

`dataforseo-cli` is pure-fetch. Hot path:

| Subcommand                                              | Status      |
| ------------------------------------------------------- | ----------- |
| `--help`, `--version`                                   | ✅ Works     |
| `keywords`, `serp`, `backlinks`, `labs`, `ai`, `trends` | ✅ Works     |
| `raw <path>`                                            | ✅ Works     |
| `login`, `whoami` (writes/reads `~/.config/`)           | ⚠️ Use env vars instead in workers. |

## License

MIT
