---
name: airtable
description: |
  Query Airtable via the read-only `airtable` CLI: list accessible bases, inspect table/field/view schema, and read records (with views, field selection, formula filters, sorting, and text search). Command names mirror the Airtable MCP read tools. Use whenever the user asks about Airtable data — "list my bases", "what tables are in base X", "show records where Status is Done", "find rows matching acme", "get record recXXX", "what's the schema of the Tasks table" — or pulls Airtable data into a report. Returns JSON (default, jq-friendly), JSONL, tables, or CSV. Full param docs via `airtable <command> --help`.
allowed-tools:
  - Bash(airtable *)
  - Bash(bunx airtable *)
---

# airtable

Read-only client for the Airtable Web API. Every command is a GET — nothing here can mutate Airtable data (the create/update/delete tools are intentionally absent).

## Setup

A single [personal access token](https://airtable.com/create/tokens) (PAT), used as a bearer:

```sh
export AIRTABLE_API_KEY=patXXXXXXXXXXXXXX
airtable whoami                 # token's user id + scopes
airtable list-bases             # discover base ids (appXXXXXXXX)
export AIRTABLE_BASE_ID=appXXXXXXXX   # default base; override per command with --baseId
```

`token: --token > AIRTABLE_API_KEY > AIRTABLE_TOKEN` · `base: --baseId > --base > AIRTABLE_BASE_ID`.

## Commands (= Airtable MCP read tools)

```sh
airtable list-bases
airtable list-tables --baseId appXXX --detailLevel identifiersOnly   # alias: airtable schema
airtable describe-table --baseId appXXX --tableIdOrName Tasks
airtable list-records --baseId appXXX --tableIdOrName Tasks \
  --view "Grid view" --fields Name,Status --filterByFormula "{Status}='Done'" \
  --sort Name --sort Created:desc --maxRecords 500 --all
airtable get-record --baseId appXXX --tableIdOrName Tasks --recordId recXXX
airtable search-records --baseId appXXX --tableIdOrName Tasks --searchTerm acme
```

- `--tableIdOrName` takes a table **name or id** (`-t`/`--table` is a short alias).
- `--detailLevel`: `full` (default) · `identifiersOnly` · `tableIdentifiersOnly`.
- `--filterByFormula` is an [Airtable formula](https://support.airtable.com/docs/formula-field-reference), e.g. `AND({Stage}='Won', {Amount}>1000)`.
- `search-records` builds a `SEARCH()` formula over `--fields` (or all schema fields if omitted).

## Anything else

```sh
airtable api /meta/bases
airtable api /appXXX/Tasks -q maxRecords=3 -q "fields[]=Name"
```

## Output & pagination

- `-f json` (default, jq-friendly) · `jsonl` · `table` · `csv`. Table/CSV lift each record's `fields.*` to top-level columns.
- Airtable paginates with an `offset` cursor; `--all` walks all pages (up to `--maxRecords`). `--pageSize` ≤ 100.
- Errors are emitted as a single JSON object on stderr with a non-zero exit — `{"error":...,"status":...,"hint":...}`.
