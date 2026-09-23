# @mirage-cli/markup

Wraps `@mirage-cli/markup-cli` as an importable mirage / Cloudflare-Worker command via `@mirage-cli/core`.

```ts
import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
import { markupCommand, markupResource } from "@mirage-cli/markup";

// One-shot CommandFn
export const markup = command({
  name: "markup",
  resource: null,
  spec: new CommandSpec({
    rest: new Operand({ kind: OperandKind.TEXT }),
    description: "ViewEngine Markup CLI",
  }),
  fn: markupCommand,
});

// Or as a mountable Resource:
const ws = new Workspace({ ... });
ws.addMount("/cli/markup", await markupResource());
await ws.execute("markup boards --json");
```

See `@mirage-cli/markup-cli` for the underlying command surface.
