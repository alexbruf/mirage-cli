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
await ws.execute("ga4 --property 123 report --dimensions country --metrics sessions --date-ranges '[{\"startDate\":\"7daysAgo\",\"endDate\":\"yesterday\"}]'");
```

**Runs in workerd.** The underlying CLI is fetch-only — no gRPC, no protobuf.js, no Google client libs. Auth via `GA4_OAUTH_ACCESS_TOKEN` env (preferred for headless / Worker use), service-account JSON (signed via Web Crypto), or interactive `ga4 login` (PKCE — Node/Bun only).

See `@mirage-cli/ga4-cli` for the underlying command surface.
