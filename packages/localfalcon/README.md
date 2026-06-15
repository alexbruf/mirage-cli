# @mirage-cli/localfalcon

Local Falcon CLI wrapped as an importable Commander program + a ready-made mirage `Resource`, for mirage runtimes and Cloudflare Workers.

```ts
import { buildProgram, localfalconCommand, localfalconResource } from "@mirage-cli/localfalcon";
```

Auth via `LOCALFALCON_API_KEY`. Fetch-only (workerd-safe). All commands read existing data except `scan`, which runs a new (billable) grid scan — gate it behind write access in read-only deployments.

See `@mirage-cli/localfalcon-cli` for the command surface.
