---
name: callrail
description: |
  Query CallRail (call tracking) via the read-only `callrail` CLI: calls with transcriptions/summaries/sentiment, call volume summaries and timeseries, tracking numbers, SMS conversations, form submissions, companies, tags. Multi-account via profiles (one API key per account). Use whenever the user asks about call tracking data — "how many calls did X get last month", "show missed calls", "which sources drive calls", "pull call transcripts", "first-time callers this week" — or pulls phone-lead data into a report. Returns JSON (default, jq-friendly), JSONL, tables, or CSV. Full param docs via `callrail <group> <command> --help`.
allowed-tools:
  - Bash(callrail *)
  - Bash(bunx callrail *)
---

# callrail

Read-only client for the CallRail v3 API. Every command is a GET — nothing here can mutate CallRail data.

## Setup / accounts

One API key per CallRail account, managed as named **profiles**:

```sh
callrail auth list                     # profiles (disk + env), active one marked
callrail auth whoami                   # resolved creds + accounts the key sees
callrail auth add <name> --api-key <k> # add + verify a profile (auto-pins its account)
callrail auth use <name>               # switch the active profile
```

Env-only alternative (CI / workers): `CALLRAIL_API_KEY` (single) or
`CALLRAIL_API_KEYS="acme:key1,foxhaven:key2"` + `--profile <name>`.

**Switching clients mid-session: prefer the per-call `--profile <name>` flag over
`auth use` — it doesn't change global state.**

## Want X → run Y

| Need | Command |
| ---- | ------- |
| Calls in a period | `callrail calls list --date-range last_30_days` |
| Missed calls | `callrail calls list --answer-status missed --date-range last_7_days` |
| Good leads only | `callrail calls list --lead-status good_lead --date-range this_month` |
| Transcript / AI summary / sentiment | `callrail calls get <id> --fields transcription,call_summary,sentiment` |
| Bulk calls w/ summaries | `callrail calls list --date-range last_7_days --fields call_summary,sentiment -f jsonl` |
| Which sources drive calls | `callrail calls summary --group-by source --date-range last_30_days` |
| Calls per keyword / campaign / landing page | `callrail calls summary --group-by keywords` (or `campaign`, `landing_page`, `referrer`) |
| Call volume over time | `callrail calls timeseries --interval day --date-range last_30_days` (or `--interval week/month`) |
| Per-client rollup (agency account) | `callrail calls summary --group-by company --date-range last_month` |
| Tracking numbers | `callrail trackers list` (`--company <id>`, `--status active`) |
| SMS conversations | `callrail conversations list --date-range last_7_days` |
| Form submissions | `callrail forms list --date-range last_30_days` |
| Companies in the account | `callrail companies list` |
| Users / tags / integrations | `callrail users list` / `callrail tags list` / `callrail integrations list --company <id>` |
| Anything not wrapped | `callrail api '/a/{account}/calls.json' -q date_range=today` (raw GET) |

## Common workflows

**Monthly client call report** (per company in an agency account):

```sh
callrail companies list -f jsonl                                   # find company_id
callrail calls summary --group-by source --company <id> --date-range last_month
callrail calls timeseries --interval day --company <id> --date-range last_month
callrail calls list --company <id> --date-range last_month --lead-status good_lead -f jsonl
```

**Lead quality review** — pull summaries+sentiment for recent answered calls, then read:

```sh
callrail calls list --date-range last_7_days --answer-status answered \
  --fields call_summary,sentiment,lead_status -f jsonl
```

**Cross-client sweep** (one profile per client):

```sh
callrail auth list -f jsonl                                        # enumerate profiles
callrail calls summary --group-by source --date-range last_7_days --profile <each>
```

## Flags & conventions

- **Output**: JSON envelope by default (pagination metadata intact) · `-f jsonl` one record/line (best for piping or many rows) · `-f table` for humans · `-f csv` for spreadsheets.
- **Pagination**: `--page` / `--per-page` (max 250) · `--all` fetches every page, capped by `--max-records` (default 2500 — mind the 1,000 req/hr API limit; a JSON note flags truncation).
- **Dates**: `--date-range` presets (`today`, `yesterday`, `last_7_days`, `last_30_days`, `this_month`, `last_month`, ...) or `--start-date`/`--end-date` (ISO 8601) + `--time-zone`.
- **Fields**: heavy fields (`transcription`, `call_summary`, `sentiment`, `keywords`, `milestones`, `gclid`, ...) are off by default — request via `--fields a,b,c`.
- **Account**: auto-detected when the key sees one account; otherwise `--account <id>` (errors list the choices).
- **Errors**: JSON on stderr with `status` + `hint`, exit 1. `429` = rate limited; back off.
