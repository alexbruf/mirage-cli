---
"@mirage-cli/hubspot-cli": patch
---

`HUBSPOT_ACCOUNTS`: a JSON map of account name to access token, selected per call with `--account <name>`, so one host can read several HubSpot portals. `account list` shows the names (never the tokens). Takes precedence over `HUBSPOT_ACCESS_TOKEN`; `--token` still wins.
