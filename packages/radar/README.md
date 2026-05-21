# @mirage-cli/radar

Wraps `@mirage-cli/radar-cli` as an importable mirage / Cloudflare-Worker command via `@mirage-cli/core`.

```ts
import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
import { radarCommand, radarResource } from "@mirage-cli/radar";

// One-shot CommandFn
export const radar = command({
  name: "radar",
  resource: null,
  spec: new CommandSpec({
    rest: new Operand({ kind: OperandKind.TEXT }),
    description: "Radar CLI",
  }),
  fn: radarCommand,
});

// Or as a mountable Resource:
const ws = new Workspace({ ... });
ws.addMount("/cli/radar", await radarResource());
await ws.execute("radar jobs list --format json");
```

See `@mirage-cli/radar-cli` for the underlying command surface.
