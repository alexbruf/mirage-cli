---
name: ahrefs
description: |
  Query Ahrefs (SEO data) via the `ahrefs` CLI: keyword volume/KD/CPC, backlinks, referring domains, anchor text, organic keywords, top pages, organic competitors, bulk domain comparison, rank tracking, site audits, GSC pull-through. Use whenever the user asks for SEO data on a domain or keyword — "what's the DR of X", "find keywords for Y", "compare backlinks of X and Y", "show me top pages for Z", or pulls SEO signals into a workflow. Returns colored tables, JSON (jq-friendly), or CSV. Full param docs via `ahrefs <command> --help`.
allowed-tools:
  - Bash(ahrefs *)
  - Bash(bunx ahrefs *)
---

# ahrefs

Maps cleanly to the Ahrefs web UI. Each command's `--help` carries the full Ahrefs spec: param types, enum values, defaults, available `--select` columns (with per-column unit cost), and one example.

## Setup

Needs `AHREFS_API_KEY` in env. Verify:

```sh
ahrefs account limits
```

## Want X → run Y

| Need                                | Command                                                          |
| ----------------------------------- | ---------------------------------------------------------------- |
| Volume / KD / CPC for a keyword     | `ahrefs keywords overview "<kw>" --country us`                   |
| Expand a seed (PAA-style)           | `ahrefs keywords matching-terms "<seed>" --country us`           |
| Related / suggested keywords        | `ahrefs keywords related-terms "<seed>" --country us`            |
| Snapshot metrics for a domain       | `ahrefs site-explorer overview <domain>`                         |
| Keywords a domain ranks for         | `ahrefs site-explorer organic-keywords <domain> --country us`    |
| Top traffic pages                   | `ahrefs site-explorer top-pages <domain> --country us`           |
| Backlinks list                      | `ahrefs site-explorer backlinks <domain>`                        |
| Referring domains                   | `ahrefs site-explorer refdomains <domain>`                       |
| Anchor text inventory               | `ahrefs site-explorer anchors <domain>`                          |
| Organic competitors                 | `ahrefs site-explorer organic-competitors <domain>`              |
| Domain Rating / DR history          | `ahrefs site-explorer domain-rating <domain>` / `…-history`      |
| Compare many domains at once        | `ahrefs batch-analysis --targets "a.com,b.com,c.com"`            |
| GSC keywords / pages                | `ahrefs gsc keywords` / `ahrefs gsc pages`                       |
| Rank tracker / site audit projects  | `ahrefs rank-tracker overview` / `ahrefs site-audit projects`    |
| Units consumed / remaining          | `ahrefs account limits`                                          |

## Common flags

- **Convenience filters** (auto-build the `where` JSON): `--max-kd N`, `--min-volume N`, `--max-position N`, `--min-dr N`.
- **Output**: colored table by default · `--json` for `jq` pipelines · `--csv` for spreadsheets.
- **Limit**: `--limit N` (max 1000 per call; no offset/pagination on Ahrefs).
- **Columns**: `--select col1,col2,...` overrides defaults. Available columns listed in `--help`.
- **Cache**: `--cache 1h` caches GETs to `~/.cache/ahrefs-cli/`.
- **Debug**: `--explain` prints the exact `curl` to stderr.
- **Compact help**: `--help-short` for flag table only (no column inventory).

## Notes

- Every call costs API units. `ahrefs <cmd> --help` lists per-column unit cost; some columns are `(+10u)` per row.
- Quote multi-word values: `"vegan protein"`.
- Country is ISO 3166-1 alpha-2 (`us`, `gb`, `de`).
