# @mirage-cli/ga4

Wraps `@mirage-cli/ga4-cli` as an importable mirage / Cloudflare-Worker command via `@mirage-cli/core`.

```ts
import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
import { ga4Command, ga4Resource } from "@mirage-cli/ga4";

export const ga4 = command({
  name: "ga4",
  resource: null,
  spec: new CommandSpec({
    rest: new Operand({ kind: OperandKind.TEXT }),
    description: "Google Analytics 4 CLI",
  }),
  fn: ga4Command,
});

const ws = new Workspace({ ... });
ws.addMount("/cli/ga4", await ga4Resource());
await ws.execute("ga4 --property 123456789 report --metrics sessions --dimensions country");
```

**Worker note:** the underlying CLI uses gRPC via `google-gax`. Node/Bun-only. Workerd cannot host this directly — use the REST flavor of the GA4 Data API directly if you need worker-side access.

See `@mirage-cli/ga4-cli` for the underlying command surface.
