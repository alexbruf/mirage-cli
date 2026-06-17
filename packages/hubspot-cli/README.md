# @mirage-cli/hubspot-cli

Read-only CLI for the [HubSpot API](https://developers.hubspot.com/docs/api/overview) — CRM (contacts, companies, deals, tickets, products, line items, quotes, activities, **and any custom object**), CRM properties / owners / pipelines / associations, marketing (forms, emails, campaigns), and CMS (blog posts/authors/tags, site pages, HubDB). The grammar mirrors the official [`hs` CLI](https://developers.hubspot.com/docs/developer-tooling/local-development/hubspot-cli) (`hubspot <noun> <verb>`) and **reuses your existing `hs account auth` login**, so there's no new auth system to learn.

Every command is a GET — or the read-only `/search` POST. The client has no create/update/delete surface, so it's safe to hand to an LLM driver.

```sh
bun add -g @mirage-cli/hubspot-cli   # installs the `hubspot` bin
hubspot --help
```

> The binary is `hubspot`, not `hs` — `hs` belongs to the official dev-tooling CLI (`@hubspot/cli`). This tool is a *data-read* companion to it, not a replacement.

## Credentials

Every HubSpot token type is just an `Authorization: Bearer <token>` at the API layer; the only difference is how the token is obtained. Resolution per invocation, in order:

```
1. --token / HUBSPOT_ACCESS_TOKEN                       private app token or any OAuth/access token (used directly)
2. HUBSPOT_PERSONAL_ACCESS_KEY (+ HUBSPOT_ACCOUNT_ID)   personal access key, exchanged for a short-lived token
3. ~/.hscli/config.yml account (--account <name|id>)   reuses your `hs account auth` login
```

### Quickest (headless / CI / workers)

Create a [private app](https://developers.hubspot.com/docs/api/private-apps), grant it the read scopes you need, and:

```sh
export HUBSPOT_ACCESS_TOKEN=pat-na1-xxxxxxxx
hubspot account whoami
```

### Reuse your `hs` login (workstation)

If you've already run `hs account auth`, the accounts in `~/.hscli/config.yml` just work — the CLI exchanges the stored personal access key for a short-lived token at call time (the same exchange the `hs` CLI performs internally), cached in process.

```sh
hubspot account list                 # accounts found in ~/.hscli/config.yml
hubspot --account prod crm deals list
```

## CRM

Every CRM object — standard or custom — shares the same `list / get / search` shape:

```sh
hubspot crm contacts list --properties email,firstname,lastname,lifecyclestage -f table
hubspot crm contacts get 51 --properties email,firstname
hubspot crm contacts search --query acme --limit 50
hubspot crm deals list --all --max-records 5000 --properties dealname,amount,dealstage
hubspot crm deals search --filter dealstage=closedwon --sort amount --order desc

# Custom objects (or anything not given a friendly name) via `object`:
hubspot crm object list p_pets --properties name,species
hubspot crm object get p_pets 12345

# Metadata
hubspot crm properties contacts       # property definitions
hubspot crm owners --email rep@co.com
hubspot crm pipelines deals
hubspot crm associations contacts 51 companies
```

Standard object subcommands: `contacts companies deals tickets products line-items quotes calls emails meetings notes tasks`.

## Marketing & CMS

```sh
hubspot marketing forms list
hubspot marketing emails list
hubspot marketing campaigns list

hubspot cms blog-posts list --limit 20
hubspot cms blog-authors list
hubspot cms pages list
hubspot cms hubdb tables
hubspot cms hubdb rows 1234567
```

## Raw GET escape hatch

Anything the named commands don't model is still one GET away — so the *entire* read surface of the API is reachable:

```sh
hubspot api /crm/v3/objects/companies -q limit=5 -q properties=name -q properties=domain
hubspot api /account-info/v3/details
```

## Pagination & output

- `--limit <n>` sets the page size; `--after <cursor>` resumes from a `paging.next.after` cursor.
- `--all` walks every page (capped by `--max-records`, default 1000).
- `-f, --format json|jsonl|table|csv` — default `json` (raw envelope, jq-friendly). `table`/`csv` lift CRM `properties.*` up to top-level columns.

## Environment variables

| Var | Purpose |
| --- | --- |
| `HUBSPOT_ACCESS_TOKEN` | Private app access token or any OAuth/access token. Used directly as a bearer. |
| `HUBSPOT_PERSONAL_ACCESS_KEY` | Personal access key (the `hs` credential). Exchanged for a short-lived token. |
| `HUBSPOT_ACCOUNT_ID` | Portal id to pin when exchanging a personal access key. |
| `HUBSPOT_API_BASE_URL` | Override the API base (default `https://api.hubapi.com`). |

## Worker compatibility

Pure `fetch`. `node:fs` is touched only when env credentials are absent and `~/.hscli/config.yml` is read; set `HUBSPOT_ACCESS_TOKEN` in workerd and that path never runs.
