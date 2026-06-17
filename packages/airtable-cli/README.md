# @mirage-cli/airtable-cli

Read-only CLI for the [Airtable Web API](https://airtable.com/developers/web/api/introduction) — bases, table schema, and records. Every command is a GET; the client has no create/update/delete surface, so it's safe to hand to an LLM driver.

The command names mirror the **Airtable MCP server's read tools** — the same vocabulary the official [`@airtable/mcp-cli`](https://github.com/Airtable/airtable-mcp-cli) discovers from the server — with that CLI's flag names (`--baseId`, `--tableIdOrName`, `--recordId`). The difference: this hits the stable Airtable Web API directly (no live MCP connection, no experimental tool churn), and the 7 write tools are intentionally absent.

```sh
bun add -g @mirage-cli/airtable-cli   # installs the `airtable` bin
airtable --help
```

## Credentials

A single [personal access token](https://airtable.com/create/tokens) (PAT) used as a bearer — the legacy API-key auth was removed by Airtable in Feb 2024. One PAT covers whichever bases you granted it, so there's no profile store; you just pick a base.

```
token:  --token > AIRTABLE_API_KEY > AIRTABLE_TOKEN
base:   --baseId (per command) > --base > AIRTABLE_BASE_ID
```

```sh
export AIRTABLE_API_KEY=patXXXXXXXXXXXXXX
airtable whoami                  # token's user id + scopes
airtable list-bases             # discover base ids
export AIRTABLE_BASE_ID=appXXXXXXXX
```

## Commands (= Airtable MCP read tools)

```sh
# Bases & schema
airtable list-bases
airtable list-tables --baseId appXXX --detailLevel identifiersOnly   # alias: airtable schema
airtable describe-table --baseId appXXX --tableIdOrName Tasks

# Records
airtable list-records --baseId appXXX --tableIdOrName Tasks \
  --view "Grid view" --fields Name,Status --filterByFormula "{Status}='Done'" \
  --sort Name --sort CreatedAt:desc --maxRecords 500 --all
airtable get-record --baseId appXXX --tableIdOrName Tasks --recordId recXXX
airtable search-records --baseId appXXX --tableIdOrName Tasks --searchTerm acme
```

`--tableIdOrName` accepts a table **name or id**; `-t/--table` is a short alias. `--detailLevel` is one of `full` (default), `identifiersOnly`, `tableIdentifiersOnly`. `search-records` builds an Airtable `SEARCH()` formula over `--fields` (or, if omitted, every field in the table's schema).

## Raw GET escape hatch

Anything the named commands don't model is one GET away:

```sh
airtable api /meta/bases
airtable api /appXXX/Tasks -q maxRecords=3 -q "fields[]=Name"
```

## Pagination & output

- Airtable paginates with an `offset` cursor. `--all` walks every page (up to `--maxRecords`, uncapped if unset). `--pageSize` ≤ 100.
- `-f, --format json|jsonl|table|csv` — default `json` (raw envelope, jq-friendly). `table`/`csv` lift each record's `fields.*` up to top-level columns (so `Name` is a column, not a nested blob).

## Environment variables

| Var | Purpose |
| --- | --- |
| `AIRTABLE_API_KEY` | Personal access token (bearer). `AIRTABLE_TOKEN` is an accepted alias. |
| `AIRTABLE_BASE_ID` | Default base id `appXXXXXXXX` (override per command with `--baseId`). |
| `AIRTABLE_API_BASE_URL` | Override the API base (default `https://api.airtable.com/v0`). |

## Worker compatibility

Pure `fetch`, GET-only — no Node-only imports at all. Runs unchanged under workerd.
