# @mirage-cli/openrouter

Mirage and Cloudflare Worker wrapper for `@mirage-cli/openrouter-cli`.

```ts
import { buildProgram, openrouterCommand, openrouterResource } from "@mirage-cli/openrouter";
```

- `buildProgram()` returns one cached Commander program.
- `openrouterCommand` is ready for a Mirage `command({ fn })` registration.
- `openrouterResource()` lazily imports Mirage core and returns a command-only
  remote resource.

Set `OPENROUTER_API_KEY` before executing commands. Optional attribution and
base URL environment variables are documented in the CLI package.

All remote calls use global `fetch`; the data path has no filesystem,
subprocess, interactive-login, or SDK dependency. Request files are loaded only
when the operator explicitly uses `openrouter chat --request <path>`.

## Access boundary

`models`, `providers list`, `key`, and `generation` are reads. `chat` creates
billable model inference. A read-only Mirage deployment should block `chat`,
while a write-mode mount may enable it. The wrapper does not expose API-key
creation, deletion, or arbitrary raw HTTP calls.
