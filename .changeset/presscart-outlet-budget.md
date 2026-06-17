---
"@mirage-cli/presscart-cli": minor
"@mirage-cli/presscart": minor
---

Add budget filtering for Presscart marketplace buy-list workflows. `presscart outlets list` gains `--max-price`/`--min-price` (whole USD), `--all` pagination, a `price_usd` column, and stderr total-count summaries. `presscart products listings` also gains `--max-price`/`--min-price` over `prices[].unit_amount` (whole USD, not Stripe cents), with pagination summaries kept on stderr so JSON/CSV stdout stays pipeable.
