---
"@mirage-cli/seogets-cli": minor
"@mirage-cli/seogets": patch
---

Fix gsc/gsc-top/gsc-compare against the reconnected SEO Gets MCP, which now
rejects `page`/`page_size` on `get_gsc_performance` (`additionalProperties:
false`) and instead returns the whole window in one response capped at ~50,000
rows.

- `gsc`, `gsc-top`, and `gsc-compare` no longer send pagination params;
  `--page`/`--page-size`/`--max-pages` remain accepted as deprecated no-ops.
- `gscTopBy`/`gscCompare` fetch each window once; `truncatedByCap`/`truncated`
  now flag responses that hit the server row cap (exported as
  `SERVER_ROW_CAP`).
- `GscPageArgs.page`/`page_size` are optional and deprecated; `pageHasMore` is
  deprecated but still exported for compatibility.
