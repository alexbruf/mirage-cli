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

All remote calls use global `fetch`; the data path has no subprocess,
interactive-login, or SDK dependency. Request files and image references are
loaded only when explicitly requested. Generated image bytes can be written to
a local path or a Mirage-mounted path such as `/sessions/<id>/image.png`.

## Access boundary

`models`, `images models`, `images endpoints`, `providers list`, `key`, and
`generation` are reads. `chat` and `images generate` create billable model
inference. A read-only Mirage deployment should block those two billable
commands, while a write-mode mount may enable them. The wrapper does not expose
API-key creation, deletion, or arbitrary raw HTTP calls.
