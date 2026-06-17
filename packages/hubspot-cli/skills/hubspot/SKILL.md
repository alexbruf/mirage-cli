---
name: hubspot
description: |
  Query HubSpot (CRM + marketing + CMS) via the read-only `hubspot` CLI: contacts, companies, deals, tickets, products, line items, quotes, activities (calls/emails/meetings/notes/tasks), and any custom object — plus CRM properties/owners/pipelines/associations, marketing forms/emails/campaigns, and CMS blog posts/pages/HubDB. Grammar mirrors the official `hs` CLI and reuses the `hs account auth` login. Use whenever the user asks about HubSpot data — "how many deals are in stage X", "list contacts created this month", "what's the amount on deal Y", "show our marketing forms", "pull companies in industry Z", "search tickets" — or pulls CRM/pipeline data into a report. Returns JSON (default, jq-friendly), JSONL, tables, or CSV. Full param docs via `hubspot <group> <command> --help`.
allowed-tools:
  - Bash(hubspot *)
  - Bash(bunx hubspot *)
---

# hubspot

Read-only client for the HubSpot API. Every command is a GET (or the read-only `/search` POST) — nothing here can mutate HubSpot data.

## Setup / accounts

Every token type is a bearer at the API layer. Resolution order:

1. `--token` / `HUBSPOT_ACCESS_TOKEN` — a private app access token (or any OAuth/access token), used directly.
2. `HUBSPOT_PERSONAL_ACCESS_KEY` (+ `HUBSPOT_ACCOUNT_ID`) — a personal access key, exchanged for a short-lived token.
3. `~/.hscli/config.yml` — reuses the existing `hs account auth` login; pick one with `--account <name|id>`.

```sh
hubspot account whoami                 # resolved credential source + portal details
hubspot account list                   # accounts found in ~/.hscli/config.yml
```

## CRM (the workhorse)

Standard and custom objects share one `list / get / search` shape:

```sh
hubspot crm contacts list --properties email,firstname,lastname,lifecyclestage
hubspot crm contacts get 51 --properties email,firstname
hubspot crm contacts search --query acme --limit 50
hubspot crm deals list --all --max-records 5000 --properties dealname,amount,dealstage
hubspot crm deals search --filter dealstage=closedwon --sort amount --order desc
hubspot crm object list p_pets         # custom object by type / objectTypeId
hubspot crm properties contacts        # property definitions for an object type
hubspot crm owners --email rep@co.com
hubspot crm pipelines deals
hubspot crm associations contacts 51 companies
```

Standard objects: `contacts companies deals tickets products line-items quotes calls emails meetings notes tasks`.

`search` builds a read-only `POST /search`: `--query` is free text, `--filter prop=value` adds EQ filters (repeatable, ANDed), `--sort`/`--order` sort, `--properties` selects returned fields.

## Marketing & CMS

```sh
hubspot marketing forms list
hubspot marketing emails list
hubspot marketing campaigns list
hubspot cms blog-posts list --limit 20
hubspot cms pages list
hubspot cms hubdb tables
hubspot cms hubdb rows 1234567
```

## Anything else

The raw GET escape hatch reaches every read endpoint the named commands don't model:

```sh
hubspot api /crm/v3/objects/companies -q limit=5 -q properties=name
hubspot api /account-info/v3/details
```

## Output & pagination

- `-f json` (default, jq-friendly) · `jsonl` · `table` · `csv`. Table/CSV lift CRM `properties.*` to top-level columns.
- `--limit <n>` page size; `--after <cursor>` resumes from `paging.next.after`; `--all` walks all pages (capped by `--max-records`).
- Errors are emitted as a single JSON object on stderr with a non-zero exit — `{"error":...,"status":...,"hint":...}`.
