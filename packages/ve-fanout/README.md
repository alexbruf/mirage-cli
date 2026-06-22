# @mirage-cli/ve-fanout

VE Fanout CLI (AI query fan-out) wrapped as an importable Commander program + a ready-made mirage `Resource`, for mirage runtimes and Cloudflare Workers.

```ts
import { buildProgram, veFanoutCommand, veFanoutResource } from "@mirage-cli/ve-fanout";
```

Auth via `VE_FANOUT_TOKEN` (optionally `VE_FANOUT_ORG_ID` / `VE_FANOUT_API_URL`). Token-based read calls are workerd-safe.

Most commands read existing data. `queries create`, `queries regenerate`, and `queries run-engine` are **billable** (consume org credits); `queries delete` is **destructive** — gate them behind write access in read-only deployments. `login`/`logout`/`orgs use` are interactive/Node-only.

See `@mirage-cli/ve-fanout-cli` for the full command surface.
