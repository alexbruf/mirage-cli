---
"@mirage-cli/airtable-cli": minor
"@mirage-cli/airtable": minor
---

Add `@mirage-cli/airtable` + `@mirage-cli/airtable-cli` — read-only Airtable CLI (bases, table schema, records). Self-built GET-only `fetch` client against the Airtable Web API. Command names mirror the Airtable MCP server's read tools — `list-bases`, `list-tables` (alias `schema`), `describe-table`, `list-records`, `search-records`, `get-record`, `whoami` — with the official `@airtable/mcp-cli` flag names (`--baseId`, `--tableIdOrName`, `--recordId`, `--fields`, `--view`, `--filterByFormula`, `--sort`, `--maxRecords`, `--all`). Auth is a single personal access token (`AIRTABLE_API_KEY`); base via `AIRTABLE_BASE_ID`/`--baseId`. Lockstep 0.1.0.
