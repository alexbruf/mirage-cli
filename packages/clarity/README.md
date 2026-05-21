# @mirage-cli/clarity

Wraps `@mirage-cli/clarity-cli` as an importable mirage / Cloudflare-Worker command via `@mirage-cli/core`.

```ts
import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
import { clarityCommand, clarityResource } from "@mirage-cli/clarity";

export const clarity = command({
  name: "clarity",
  resource: null,
  spec: new CommandSpec({
    rest: new Operand({ kind: OperandKind.TEXT }),
    description: "Microsoft Clarity CLI",
  }),
  fn: clarityCommand,
});

const ws = new Workspace({ ... });
ws.addMount("/cli/clarity", await clarityResource());
await ws.execute("clarity ask 'top browsers last 7 days' --json");
```

See `@mirage-cli/clarity-cli` for the underlying command surface.
