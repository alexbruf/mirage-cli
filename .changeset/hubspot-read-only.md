---
"@mirage-cli/hubspot-cli": minor
"@mirage-cli/hubspot": minor
---

Add `@mirage-cli/hubspot` + `@mirage-cli/hubspot-cli` — read-only HubSpot CLI (CRM contacts/companies/deals/tickets/products/activities and custom objects, CRM properties/owners/pipelines/associations, marketing forms/emails/campaigns, CMS blog/pages/HubDB) with `hs`-style grammar. Self-built `fetch` client (GET + read-only `/search` POST only). Auth accepts a private app / OAuth access token directly, exchanges a personal access key, or reuses the existing `hs account auth` login in `~/.hscli/config.yml`. Lockstep 0.1.0.
