# @mirage-cli/mobbin

Wraps `@mirage-cli/mobbin-cli` as an importable mirage / Cloudflare-Worker command via `@mirage-cli/core`.

```ts
import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
import { mobbinCommand, mobbinResource } from "@mirage-cli/mobbin";

// One-shot CommandFn
export const mobbin = command({
  name: "mobbin",
  resource: null,
  spec: new CommandSpec({
    rest: new Operand({ kind: OperandKind.TEXT }),
    description: "Mobbin CLI",
  }),
  fn: mobbinCommand,
});

// Or as a mountable Resource:
const ws = new Workspace({ ... });
ws.addMount("/cli/mobbin", await mobbinResource());
await ws.execute("mobbin sections pricing with three tiers --json");
```

In a Worker, inject a fresh `MOBBIN_ACCESS_TOKEN` per call (access tokens last an hour). See `@mirage-cli/mobbin-cli` for the command surface.
