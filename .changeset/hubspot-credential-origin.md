---
"@mirage-cli/hubspot-cli": patch
---

hubspot: send credentials only to `https://api.hubapi.com` or a regional `https://api-<region>.hubapi.com`. `--base-url` and `HUBSPOT_API_BASE_URL` pointing anywhere else now fail before any request, the personal access key exchange uses the same check, and authenticated requests refuse redirects.
