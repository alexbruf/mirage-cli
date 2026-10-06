# @mirage-cli/windsor-cli

A read-only CLI for **Windsor.ai**: find connectors, accounts and fields, then
query or download rows from any of Windsor's 350+ connectors (Google Ads, GA4,
Search Console, Meta, LinkedIn, TikTok, GBP, HubSpot, Shopify, ...).

Filters are written SQL-style (`--where "spend > 100 and campaign like '%brand%'"`)
and translated into Windsor's JSON filter, so they run on Windsor's side.

Every command is a fetch-only GET, so the program is **workerd-safe**: no
`node:fs`, `node:http`, or interactive auth on any code path. Windsor's write
actions (`/{connector}/actions`) are deliberately not wrapped.

## Install

```bash
bun add @mirage-cli/windsor-cli
```

## Env vars

| Var               | Meaning                                                                       |
| ----------------- | ----------------------------------------------------------------------------- |
| `WINDSOR_API_KEY` | Windsor.ai API key. Get one at <https://onboard.windsor.ai/app/data-preview>. |

## Commands

| Command                         | What it returns                                                  |
| ------------------------------- | ---------------------------------------------------------------- |
| `connectors [search]`           | Every connector id, optionally filtered by substring             |
| `accounts [connector]`          | Connected accounts (id, name, datasource); all connectors if omitted |
| `fields <connector> [search]`   | Field id, name, type, description; `-t NUMERIC` filters by type  |
| `options <connector>`           | Connector options, passed to `query` with `--param key=value`    |
| `custom-fields`                 | Custom fields defined in the Windsor account                     |
| `query <connector>`             | Rows for the requested fields                                    |

Every command takes `-f, --format table|json|jsonl|csv` (default `table`; table
cells are cut at 80 characters, the other formats are never cut).

### `query` options

| Option                        | Meaning                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- |
| `-F, --fields <list>`         | Required. Comma-separated field ids                                     |
| `-w, --where <expr>`          | SQL-like filter; repeat to AND several                                  |
| `--filter <json>`             | Raw Windsor filter JSON instead of `--where`                            |
| `-s, --since <range\|date>`   | `30d` `12w` `6m` `1y` `7dT`, a Windsor preset (`last_year`, `this_month`), or `YYYY-MM-DD`. Default `30d` |
| `-u, --until <date>`          | End date `YYYY-MM-DD` (with a `--since` date)                           |
| `-a, --accounts <ids>`        | Comma-separated account ids (`select_accounts`)                         |
| `-n, --limit <n>`             | Max rows (`_max_rows`)                                                  |
| `-p, --param <key=value>`     | Extra query param, repeatable (connector options, `refresh_interval`)   |
| `--explain`                   | Print the request URL with the key redacted, without calling Windsor    |

### `--where` syntax

| Write                              | Windsor operator |
| ---------------------------------- | ---------------- |
| `=` `==`                           | `eq`             |
| `!=` `<>`                          | `neq`            |
| `>` `>=` `<` `<=`                  | `gt` `gte` `lt` `lte` |
| `contains 'x'` or `~ 'x'`          | `contains`       |
| `not contains 'x'` or `!~ 'x'`     | `ncontains`      |
| `like '%x%'` / `not like '%x%'`    | `contains` / `ncontains` |
| `is null` / `is not null`          | `null` / `notnull` |

Combine with `and` / `or` (`and` binds tighter) and parentheses. Strings take
single or double quotes (`'it''s'` escapes a quote); bare words are strings too.
`LIKE` accepts one substring only, because Windsor has no wildcard matching.

## Examples

```bash
windsor connectors google
windsor accounts searchconsole
windsor fields google_ads cost -t numeric
windsor query searchconsole -F query,clicks,impressions,position -s 28d \
  -a "sc-domain:example.com" -w "clicks >= 5 and query not like '%brand%'"
windsor query googleanalytics4 -F date,source,sessions -s 7d \
  -w "(source = google or source = bing) and sessions > 0" -f csv > ga4.csv
windsor query all -F date,datasource,spend -a google_ads__123-456-7890,facebook__98765
```

The `all` connector queries several platforms at once; its account ids take a
`<connector>__` prefix, which is how `windsor accounts` (with no connector)
prints them.
