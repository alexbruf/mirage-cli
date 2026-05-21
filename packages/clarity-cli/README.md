# @mirage-cli/clarity-cli

Microsoft Clarity CLI — dashboard queries, session recordings (with playable URLs), AI-referral traffic visibility, and docs search.

```
bun add -g @mirage-cli/clarity-cli
clarity auth <your-token>
clarity ask "top browsers last 7 days"
clarity sessions --days 7 --rage-clicks --device Mobile -n 10
clarity ai-traffic --days 30
clarity insights --days 1 --dim1 OS --dim2 Country
```

## Auth

Generate an API token in your Clarity project → **Settings → Data Export**.

Then either:

- `clarity auth <token>` — stored at `~/.config/clarity-cli/config.json` (600 perms).
- `CLARITY_API_TOKEN` env var — for headless / CI.
- `--token <token>` flag — per-command override.

## Surface area

Hits both the Clarity MCP endpoints (`clarity.microsoft.com/mcp/{dashboard,recordings,documentation}`) and the public Data Export API (`clarity.ms/export-data/api/v1/project-live-insights`). The public Data Export API is rate-limited (10/day, 1-3 day lookback).

## Programmatic use

```ts
import { buildProgram } from "@mirage-cli/clarity-cli";

const program = buildProgram();
await program.parseAsync(["node", "clarity", "ask", "top browsers", "--json"]);
```

Drop-in for mirage: see `@mirage-cli/clarity`.

## Provenance

Vendored from [clarity-cli](https://github.com/alexbruf/clarity-cli) (MIT).
