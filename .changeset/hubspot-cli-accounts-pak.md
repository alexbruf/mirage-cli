---
"@mirage-cli/hubspot-cli": patch
---

`HUBSPOT_ACCOUNTS` values may be personal access keys: a value that does not start with `pat-` is exchanged for a short-lived token (cached), falling back to direct use if the exchange refuses it.
