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

## Export

Global flags, placed before the command:

| Flag | Effect |
|---|---|
| `--format json\|csv\|ndjson` | `json` (default) prints the whole response; `csv` / `ndjson` print a table of the command's natural rows |
| `--rows <path>` | Pick another array by dot path (`report.topPages`; arrays along the way flatten); `.` is the whole value |
| `--output <path>` | Write the file (Mirage VFS path such as `/sessions/<id>/x.csv`, or a local path) and print `{output, format, rows, rows_from, bytes}` |

Default rows: `projects report` → keywords, `keywords history` → one row per check (with `series`, `isTarget`), `gsc performance` → rows with each dimension as a column, `keyword-research get|run` → `report.items`, `domain-overview get|run` → `report.topKeywords`, `audits get` → `report.pages`, `prompts get|run` → `report.answers`, `keywords diagnose` → `serpTop`, `snapshot` → projects, `changes` → every list with a `section` column, `find` → matches. Lists export as-is; anything else uses the largest array of objects at the top level or under `report`. In CSV, nested objects become dotted columns, arrays of values join with `|`, arrays of objects are JSON in the cell.

`--append` (with `--output`, csv or ndjson) adds rows to an existing file; csv skips the header when the file already has one.

## Rank history by date

`keywords history <keyword-id>` takes `--days N` (1-365 back from today) or `--since YYYY-MM-DD` / `--until YYYY-MM-DD`. looker.so keeps 365 days; an older `--since` is refused with the earliest allowed date.

`keywords history-all <project-id>` exports every check for every keyword in a project, one row per check (`keywordId, keyword, series, isTarget, date, rank, ts, notFound`), with the same window flags and `--target-only` to drop competitor series. It makes one history call per keyword, paced under looker.so's 120 requests a minute, waits out a 429 once, and stops before `--max-seconds` (default 70, under a Mirage CLI call's 90s limit). When `next_offset` is not null, run again with `--offset <next_offset> --append`:

```bash
looker --format csv --output /sessions/<id>/history.csv keywords history-all <project-id> --since 2026-09-01
looker --format csv --output /sessions/<id>/history.csv --append keywords history-all <project-id> --since 2026-09-01 --offset 70
```

About one keyword per second, so a 90s call covers roughly 70 keywords.

```bash
looker --format csv --output /sessions/<id>/keywords.csv keywords list <project-id>
looker --format csv --rows report.topPages domain-overview get <id>
```

Output is JSON on stdout by default; errors are one JSON line on stderr with `status`, `kind`, `code` and `hint` where known.
