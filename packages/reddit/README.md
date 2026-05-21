# @mirage-cli/reddit

Wraps `@mirage-cli/reddit-cli` as an importable mirage / Cloudflare-Worker command via `@mirage-cli/core`.

```ts
import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
import { redditCommand, redditResource } from "@mirage-cli/reddit";

// One-shot CommandFn
export const reddit = command({
  name: "reddit",
  resource: null,
  spec: new CommandSpec({
    rest: new Operand({ kind: OperandKind.TEXT }),
    description: "Reddit CLI",
  }),
  fn: redditCommand,
});

// Or as a mountable Resource:
const ws = new Workspace({ ... });
ws.addMount("/cli/reddit", await redditResource());
await ws.execute("reddit hot programming -l 10 --json");
```

See `@mirage-cli/reddit-cli` for the underlying command surface.
