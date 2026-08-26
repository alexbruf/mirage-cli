# @mirage-cli/seogets-cli

## 0.3.1

### Patch Changes

- Send the schema-correct `property` key in SEO Gets MCP payloads.

## 0.3.0

### Minor Changes

- 7822a9d: Fix `gsc`/`gsc-top`/`gsc-compare` against the reconnected SEO Gets MCP, which now rejects `page`/`page_size` on `get_gsc_performance` (`additionalProperties: false`) and returns the whole window in one response capped at ~50,000 rows. Pagination params are no longer sent; `--page`/`--page-size`/`--max-pages` remain accepted as deprecated no-ops. `gscTopBy`/`gscCompare` fetch each window once and flag responses that hit the server row cap (exported as `SERVER_ROW_CAP`). `GscPageArgs.page`/`page_size` are optional and deprecated; `pageHasMore` is deprecated but still exported.

## 0.2.0

### Minor Changes

- 8fcf07a: Add typed TSV-in-JSON parsing, fully paginated deterministic `gsc-top` and `gsc-compare` commands, and metadata-free JSON/CSV row output.
