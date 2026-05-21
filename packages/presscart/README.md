# @mirage-cli/presscart

Wraps `@mirage-cli/presscart-cli` as an importable mirage / Cloudflare-Worker command via `@mirage-cli/core`.

```ts
import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
import { presscartCommand, presscartResource } from "@mirage-cli/presscart";

// One-shot CommandFn
export const presscart = command({
  name: "presscart",
  resource: null,
  spec: new CommandSpec({
    rest: new Operand({ kind: OperandKind.TEXT }),
    description: "Presscart CLI",
  }),
  fn: presscartCommand,
});

// Or as a mountable Resource:
const ws = new Workspace({ ... });
ws.addMount("/cli/presscart", await presscartResource());
await ws.execute("presscart campaigns list --format json");
```

See `@mirage-cli/presscart-cli` for the underlying command surface.
