---
"@mirage-cli/figma-cli": patch
---

Send API requests with `redirect: "manual"` instead of `"error"`. The Cloudflare Workers runtime rejects `redirect: "error"` before sending, so every figma command failed on a Worker. A redirect still fails the request and is never followed.
