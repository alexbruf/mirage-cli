# @mirage-cli/seogets-cli

## 0.4.0

### Minor Changes

- Fix `gsc`, `gsc-top` and `gsc-compare`, which all failed with `unknown tool "get_gsc_performance"`: SEO Gets renamed the tool to `get_site_performance`. The new tool also returns GA4 metrics by default, so these commands now request `clicks,impressions,ctr,position` explicitly and their output is unchanged. `gsc` gains `--metrics`.
- Add the read tools SEO Gets has shipped since 0.3: `perf` (merged GSC + GA4 rows: sessions, active users, key events, revenue, source/medium, event name), `portfolio list`, `portfolio perf`, `changes` (annotations, detected content edits, HTTP status and internal link changes, Google updates), `pages` and `queries` (16-month inventories, `--all` walks every page), `groups` and `clusters`. New commands emit flat typed rows; `--raw` returns the upstream envelope.
- Replace the application-failure check. The old rule ("a note with no echoed `property` is a failure") rejected every successful `list_site_pages` and `list_site_queries` call, which never echo the property, and missed `list_content_changes` failures, which echo `property: ""`. A property- or portfolio-scoped response is now a failure only when every field except `note` is null, empty, zero or false. Portfolio-scoped requests are checked too.

## 0.3.2

### Patch Changes

- Exit non-zero when a property-scoped SEO Gets response reports an application-level failure without echoing the requested property.

## 0.3.1

### Patch Changes

- Send the schema-correct `property` key in SEO Gets MCP payloads.

## 0.3.0

### Minor Changes

- 7822a9d: Fix `gsc`/`gsc-top`/`gsc-compare` against the reconnected SEO Gets MCP, which now rejects `page`/`page_size` on `get_gsc_performance` (`additionalProperties: false`) and returns the whole window in one response capped at ~50,000 rows. Pagination params are no longer sent; `--page`/`--page-size`/`--max-pages` remain accepted as deprecated no-ops. `gscTopBy`/`gscCompare` fetch each window once and flag responses that hit the server row cap (exported as `SERVER_ROW_CAP`). `GscPageArgs.page`/`page_size` are optional and deprecated; `pageHasMore` is deprecated but still exported.

## 0.2.0

### Minor Changes

- 8fcf07a: Add typed TSV-in-JSON parsing, fully paginated deterministic `gsc-top` and `gsc-compare` commands, and metadata-free JSON/CSV row output.
