# @mirage-cli/ahrefs-cli

## 0.1.10

### Patch Changes

- Default required `date` params to yesterday instead of today (BLU-292). Ahrefs site-explorer snapshots (overview/metrics, domain-rating, …) publish a day's crawl partway through that day, so `date=today` returned 0 for every metric on every domain during the pre-publish window. `metrics` requires `date` (omitting → HTTP 400), so we default to yesterday — the freshest reliably-available snapshot. Callers can still pass `--date` for any other day.
