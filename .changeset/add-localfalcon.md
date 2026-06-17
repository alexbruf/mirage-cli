---
"@mirage-cli/localfalcon": minor
"@mirage-cli/localfalcon-cli": minor
---

Add Local Falcon CLI: geo-grid local rank tracking via the Local Falcon API. Read commands (`locations`, `reports`, `report <key>`, `keywords`) surface ARP/ATRP/SoLV + map image URLs; `scan` runs a new (billable) grid scan. Auth via `LOCALFALCON_API_KEY`. Fetch-only and workerd-safe, exposes `buildProgram()` + `localfalconResource` for mirage runtimes.
