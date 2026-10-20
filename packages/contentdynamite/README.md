# @mirage-cli/contentdynamite

Thin Mirage wrapper around [`@mirage-cli/contentdynamite-cli`](../contentdynamite-cli), exposing the global `ve-dynamite` command for mirage runtimes and Cloudflare Workers.

## Use

```ts
import { contentdynamiteResource } from "@mirage-cli/contentdynamite";

workspace.addMount("/dynamite/", await contentdynamiteResource());
```

- `buildProgram()` returns one cached Commander program, built in the CLI's mount mode with `@mirage-cli/core`'s `reportCost`, so paid work shows up in the host's cost telemetry.
- `contentdynamiteCommand` is ready for a Mirage `command({ fn })` registration.
- `contentdynamiteResource()` lazily imports Mirage core and returns a command-only remote resource.

Auth comes from `VE_DYNAMITE_TOKEN` (a `ved_` API token), which the host should inject per call. `VE_DYNAMITE_API_URL` picks the API host; mount mode has no `--url` flag, so a host that pins this variable pins where the token goes. Mount mode also has no `login` and no `watch`: agents poll `get`.

## Access boundary

Reads, safe on every mount: `whoami`, `tokens list`, `profiles list|get`, `icp show|export`, `categories list`, `design-system show`, `articles get|list|parts|revisions|download|export|embed-audit|provenance-audit|research-prompt`, `revisions list|get`, `batches list|get`, `gbp list|get|image-options`, `landing-pages get|list|versions|research|deck|export|audit`, `images status`.

Paid, real money per item, gate behind a write mode: `articles write|reject`, `articles clean-provenance --rewrite`, `batches create`, `gbp write|batch|regenerate`, `landing-pages write|reiterate|new-version|fix-images`, `profiles create`, `icp regenerate`, `design-system set|rescan`, `images edit`, `evals run --judge`.

Changes stored content, gate behind a write mode: `profiles update`, `icp update`, `categories add`, `articles update|strip-embeds|clean-provenance`, `revisions verdict`, `gbp update`, `landing-pages update|criteria|fix-placeholders|rebrand`, `images commit`, `evals run` (it stores the score).

Recommend blocking outright: every `delete`, `design-system clear` and `upload` (permanent, matching the product's own MCP server), `users` (account administration), and `tokens create|revoke` (a new secret in the transcript, or revoking the mount's own token). Also block `--token`, which swaps in another account's credential.
