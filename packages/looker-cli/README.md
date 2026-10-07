# @mirage-cli/looker-cli

Fetch-only CLI for the [looker.so](https://looker.so) rank tracker. It uses the REST API (`/api/v1`) wherever an endpoint exists and the MCP endpoint (`/api/mcp`, stateless JSON-RPC) for the tools REST does not have. Both take the same key.

## Environment

| Variable | Meaning |
|---|---|
| `LOOKER_API_KEY` | Org-scoped key from Settings → API (`lk_live_…`) |
| `LOOKER_API_BASE_URL` | Override `https://looker.so` |

## Commands

| Group | Free | Writes | Paid (bills the org's DataForSEO key) |
|---|---|---|---|
| top level | `find`, `locations`, `snapshot`, `changes`, `wait` | `intake` | |
| `projects` | `list`, `get`, `report` | `create`, `update`, `archive`, `restore`, `report-link` | |
| `keywords` | `list`, `history`, `diagnose` | `add`, `status`, `archive` | `scan`, `discover` (fresh pull) |
| `audits` | `list`, `get` | | `run` |
| `backlinks` | `list`, `get` | `share` | `run` |
| `brand-visibility` | `list`, `get` | `share`, `delete` | `run`, `rerun` |
| `keyword-research` | `list`, `get` | `share`, `delete` | `run` |
| `domain-overview` | `list`, `get` | `share`, `delete` | `run`, `rerun` |
| `prompts` | `list`, `get` | `delete` | `run` |
| `competitor-gap` | `list`, `get` | `share`, `delete` | `run` |
| `gsc` | `status`, `properties`, `performance`, `inspect` | | |

MCP-backed: `find`, `snapshot`, `changes`, `wait`, `keywords diagnose|discover`, `competitor-gap *`, `gsc *`. Everything else is REST.

Paid commands report spend through `reportCost({ provider: "looker" })`, in dollars when the response carries `costMicros`.

Output is JSON on stdout; errors are one JSON line on stderr with `status`, `kind`, `code` and `hint` where known.
