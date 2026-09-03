# @mirage-cli/contentdynamite

Thin Mirage wrapper around [`@mirage-cli/contentdynamite-cli`](../contentdynamite-cli), exposing the global `ve-dynamite` command for mirage runtimes and Cloudflare Workers.

## Use

```ts
import { contentdynamiteResource } from "@mirage-cli/contentdynamite";

workspace.addMount("/dynamite/", await contentdynamiteResource());
```

The mounted command is `ve-dynamite`. Auth comes from `VE_DYNAMITE_TOKEN` (a `ved_` API token), which the host runtime should inject per call. `VE_DYNAMITE_API_URL` optionally overrides the base URL.

## Access boundary

Reads (safe to expose everywhere): `whoami`, `tokens list`, `profiles list|get`, `icp show`, `categories list`, `articles get|list|export`, `batches list|get`, `landing-pages get|list|export`, `images status`.

Billable or mutating (gate behind an explicit write mode): `profiles create|update`, `icp regenerate|update`, `categories add`, `articles write|update`, `batches create`, `landing-pages write|update|fix-images`, `images edit|commit`, `tokens create|revoke`, `upload`. Article and landing page writes spend real money per item and are never automatically retried.

Destructive (recommend blocking outright, matching the product's own MCP server policy): `articles delete`, `batches delete`, `profiles delete`, `landing-pages delete`.

## Exports

- `buildProgram(): Command` — cached, unparsed Commander program
- `contentdynamiteCommand: MirageCommandFn` — plug into `command({ fn: contentdynamiteCommand })`
- `contentdynamiteResource(): Promise<Resource>` — a ready made mount resource (lazily imports `@struktoai/mirage-core`, an optional peer dependency)
