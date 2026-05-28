# @mirage-cli/ahrefs-cli

## 0.1.11

### Patch Changes

- Resolve the required `date` default at request time, not program-build time
  (BLU-292, for real this time). The previous fix computed `daysAgo(1)` while
  building the command's option and baked it into the static `defaultValue`.
  When the program is built under a zeroed runtime clock — e.g. Cloudflare
  workerd module initialization, where `Date.now()` reads epoch 0 — that froze
  the default to `1969-12-31`, so every site-explorer metric came back 0 on the
  deployed Worker. The default now computes `daysAgo(1)` inside the command's
  `fn()`, which always runs in request context with a valid clock. `--date`
  still overrides; genuinely static defaults are unaffected.

## 0.1.10

### Patch Changes

- Default required `date` params to yesterday instead of today (BLU-292). Ahrefs site-explorer snapshots (overview/metrics, domain-rating, …) publish a day's crawl partway through that day, so `date=today` returned 0 for every metric on every domain during the pre-publish window. `metrics` requires `date` (omitting → HTTP 400), so we default to yesterday — the freshest reliably-available snapshot. Callers can still pass `--date` for any other day.
