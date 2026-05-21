# @mirage-cli/seogets

Wraps `@mirage-cli/seogets-cli` as an importable mirage / Cloudflare-Worker command via `@mirage-cli/core`.

```ts
import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
import { seogetsCommand, seogetsResource } from "@mirage-cli/seogets";

export const seogets = command({
  name: "seogets",
  resource: null,
  spec: new CommandSpec({
    rest: new Operand({ kind: OperandKind.TEXT }),
    description: "SEO Gets MCP CLI",
  }),
  fn: seogetsCommand,
});

const ws = new Workspace({ ... });
ws.addMount("/cli/seogets", await seogetsResource());
await ws.execute("seogets gsc example.com 2026-04-01 2026-04-29 query,page --format json");
```

See `@mirage-cli/seogets-cli` for the underlying command surface.
