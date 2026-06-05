# @mirage-cli/callrail-cli

Read-only CLI for the [CallRail v3 API](https://apidocs.callrail.com/) — calls (with transcriptions, AI summaries, sentiment), call summaries/timeseries, companies, tracking numbers, SMS conversations, form submissions, users, tags, integrations. Multi-account via named profiles (one API key per account). Every command is a GET; the client has no write surface.

```sh
bun add -g @mirage-cli/callrail-cli   # installs the `callrail` bin
callrail --help
```

## Credentials

One CallRail API key per **profile**. Resolution per invocation:

```
api key:  --api-key > CALLRAIL_API_KEY > profile (--profile > CALLRAIL_PROFILE
          > saved active profile) > sole profile
account:  --account > CALLRAIL_ACCOUNT_ID > profile's pinned account
          > auto-detected when the key sees exactly one account
```

### On disk (workstations)

```sh
callrail auth add acme --api-key abc123   # verifies the key, auto-pins its account
callrail auth add foxhaven                # key via CALLRAIL_API_KEY or piped stdin
callrail auth use foxhaven                # switch active profile
callrail auth list                        # fingerprints only, never full keys
```

Stored in `~/.config/callrail/config.json` (mode 0600).

### Via env (CI / Cloudflare Workers)

```sh
CALLRAIL_API_KEY=...                                   # single key
CALLRAIL_API_KEYS="acme:key1,foxhaven:key2"            # named profiles, compact
CALLRAIL_API_KEYS='{"acme":{"apiKey":"...","accountId":"ACC..."}}'  # JSON form
CALLRAIL_PROFILE=acme                                  # default profile selector
CALLRAIL_ACCOUNT_ID=ACC...                             # account override
```

Env profiles merge over disk profiles (env wins on name collision). If both `CALLRAIL_API_KEY` and `CALLRAIL_API_KEYS` are set, the singular wins (with a stderr warning).

## Commands

```
auth           add | use | list | remove | whoami
accounts       list | get [id] | use <id>
calls          list | get <id> | summary | timeseries
companies      list | get <id>
trackers       list | get <id>
conversations  list | get <id>        # SMS/MMS
forms          list | get <id>        # form submissions
users          list | get <id>
tags           list
integrations   list --company <id>
api <path>     raw GET escape hatch ({account} placeholder supported)
```

### Examples

```sh
callrail calls list --date-range last_7_days --answer-status missed
callrail calls get CAL123 --fields transcription,call_summary,sentiment
callrail calls summary --group-by source --date-range last_30_days
callrail calls timeseries --interval week --start-date 2026-01-01 --end-date 2026-03-31
callrail calls list --date-range last_month --lead-status good_lead -f jsonl
callrail trackers list --status active -f table
callrail api '/a/{account}/calls.json' -q date_range=today -q device=mobile
```

## Output

`-f json` (default — raw API envelope, jq-friendly) · `-f jsonl` (one record per line) · `-f table` · `-f csv`. Errors are JSON on stderr (`{"error", "status", "hint"}`), exit 1.

## Pagination

`--page` / `--per-page` (max 250), or `--all` to walk every page (capped by `--max-records`, default 2500 — CallRail allows 1,000 requests/hour). Truncation is flagged in the JSON output.

## AI usage

A ready-made skill with common workflows ships in [`skills/callrail/SKILL.md`](./skills/callrail/SKILL.md). For mirage / Cloudflare Workers, use [`@mirage-cli/callrail`](../callrail).

## Library use

```ts
import { buildProgram, CallRailClient, resolveCredentials } from "@mirage-cli/callrail-cli";
```

`buildProgram()` is a pure factory — no side effects on import, safe to cache.
