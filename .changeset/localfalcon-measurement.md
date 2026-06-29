---
"@mirage-cli/localfalcon-cli": minor
"@mirage-cli/localfalcon": minor
---

Fix `localfalcon scan`: send Local Falcon's required `measurement` parameter (default `mi`) on `/v2/run-scan`, and add a `--measurement <mi|km>` flag. Previously every scan failed with "You must specify a measurement" because the CLI never sent it and exposed no flag — this blocked fresh in-brain Local Falcon scans (BLU-1013).
