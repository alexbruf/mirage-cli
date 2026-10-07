---
"@mirage-cli/radar-cli": minor
---

`export-results` gains `--until <date>` (YYYY-MM-DD = through end of that day, UTC; ISO timestamp = inclusive), `--fields <list>` (emit only the named row fields), and `--no-text` (drop `responseText`, which is most of every row's bytes and also skips the server's R2 reads). The command moves from `commands/metrics.ts` to `commands/export.ts`, mirroring the prod `ve-radar` CLI.

Requires the matching visibility-tool server change (`/api/v1/export-full` accepting `until`, `fields`, `text`). Against an older server the new flags are ignored and the full export is returned. That server change also fixes rows being skipped when many share a timestamp at a 500-row page edge.
