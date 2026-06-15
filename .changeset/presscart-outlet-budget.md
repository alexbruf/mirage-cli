---
"@mirage-cli/presscart-cli": minor
"@mirage-cli/presscart": minor
---

`presscart outlets list`: add budget filtering and pagination for buy-list workflows. New `--max-price`/`--min-price` (whole USD) filter listings by placement price, `--all` follows pagination through every page (capped at 100), a `price_usd` column formats the price, and a total-count summary (`# N of TOTAL total`) is written to stderr. Price is read from `unit_amount` (whole USD) with fallbacks.
