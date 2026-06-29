---
"@mirage-cli/localfalcon-cli": patch
---

localfalcon `scan`: send Local Falcon's required `measurement` (radius unit) on `/v2/run-scan/` and add a `-m, --measurement <unit>` flag (default `mi`). Fixes fresh grid scans failing with "You must specify a measurement".
