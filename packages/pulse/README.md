# @mirage-cli/pulse

Wraps `@mirage-cli/pulse-cli` as an importable mirage / Cloudflare-Worker command via `@mirage-cli/core`.

```ts
import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
import { pulseCommand, pulseResource } from "@mirage-cli/pulse";

// One-shot CommandFn
export const pulse = command({
  name: "pulse",
  resource: null,
  spec: new CommandSpec({
    rest: new Operand({ kind: OperandKind.TEXT }),
    description: "Pulse CLI",
  }),
  fn: pulseCommand,
});

// Or as a mountable Resource:
const ws = new Workspace({ ... });
ws.addMount("/cli/pulse", await pulseResource());
await ws.execute("pulse jobs list --format json");
```

See `@mirage-cli/pulse-cli` for the underlying command surface.
