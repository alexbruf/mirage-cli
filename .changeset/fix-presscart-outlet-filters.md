---
"@mirage-cli/presscart-cli": patch
---

Fix outlet marketplace filters by applying search, location, tag, and budget constraints client-side across the complete paginated catalog. Filtered listing requests now use 1000-row catalog pages, deduplicate by listing `id`, apply `--limit` after matching, and report accurate match and unpriced-exclusion counts on stderr.

Outlet prices now fall back from the legacy flat fields to the API's actual `prices[].unit_amount` shape, using the lowest whole-dollar tier. The earlier regression test continued to pass because it covered `{ unit_amount: 250 }`, a flat record shape the API does not emit; nested API-shaped prices are now covered directly.
