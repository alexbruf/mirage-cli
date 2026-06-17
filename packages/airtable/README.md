# @mirage-cli/airtable

[`@mirage-cli/airtable-cli`](../airtable-cli) (read-only Airtable bases / schema / records CLI) as an importable mirage / Cloudflare-Worker command via [`@mirage-cli/core`](../core).

```ts
import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
import { airtableCommand } from "@mirage-cli/airtable";

export const airtable = command({
  name: "airtable",
  resource: null,
  spec: new CommandSpec({
    rest: new Operand({ kind: OperandKind.TEXT }),
    description: "Airtable CLI (read-only bases/schema/records)",
  }),
  fn: airtableCommand,
});
```

Or grab the whole thing as a mirage resource: `await airtableResource()`.

The command vocabulary mirrors the Airtable MCP server's **read** tools (`list-bases`, `list-tables`/`schema`, `describe-table`, `list-records`, `search-records`, `get-record`, `whoami`) with the official `@airtable/mcp-cli` flag names — but it hits the stable Airtable Web API directly and is read-only by construction.

## Env vars

| Var | Purpose |
| --- | --- |
| `AIRTABLE_API_KEY` | Personal access token, used as a bearer (`AIRTABLE_TOKEN` is an alias) |
| `AIRTABLE_BASE_ID` | Default base id `appXXXXXXXX` (per command: `--baseId`) |
| `AIRTABLE_API_BASE_URL` | Base URL override (default `https://api.airtable.com/v0`) |

## Worker compatibility

Pure `fetch`, GET-only (read-only by construction) — no Node-only imports at all, so it runs unchanged under workerd.
