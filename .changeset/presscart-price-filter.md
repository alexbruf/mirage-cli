---
"@mirage-cli/presscart-cli": minor
---

Presscart marketplace: add client-side budget filtering and pagination visibility.

- `outlets list` and `products listings` now accept `--min-price` / `--max-price` (whole USD), filtering the fetched page by each row's lowest `prices[].unit_amount`. Presscart has no server-side price filter, so this is applied client-side.
- List commands now print a `# N shown … of M total — page X/Y` summary to stderr (stdout stays clean for piping), so a default 25-row page is no longer mistaken for the whole ~1,466-outlet catalog.
- Documented that `unit_amount` is whole US dollars, not Stripe cents (Apple News = `775` means $775).
