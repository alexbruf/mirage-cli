# @mirage-cli/presscart-cli

Presscart CLI — drives the `api.presscart.com` REST API.

```
bun add -g @mirage-cli/presscart-cli
presscart login --token pc_xxx_xxxxxxx_xxxxxxxx_xxxxxxxx
presscart campaigns list --format json
presscart outlets list --country US --limit 50
presscart outlets list --max-price 500 --all --format csv
presscart products listings --channel facebook
presscart products listings --max-price 500 --page 1 --limit 100
```

## Auth

The Presscart API uses bearer tokens prefixed `pc_`. Get a token from your Presscart team settings; it shows only at creation time.

- `presscart login --token pc_...` — verifies via `GET /auth/token`, saves to `~/.config/presscart/session.json` (0600).
- `PRESSCART_API_TOKEN` env var — overrides the saved session (CI/headless). `PRESSCART_API_BASE_URL` overrides the base URL.

See https://docs.presscart.com/getting-started/authentication.

## Endpoints covered

| Group | Subcommands |
| --- | --- |
| `auth` | `login`, `whoami`, `logout` |
| `campaigns` | `list`, `get`, `create`, `update`, `articles`, `status-count`, `assign-items` |
| `orders` | `list`, `get`, `items`, `checkout` |
| `outlets` | `list`, `get`, `products`, `countries`, `states`, `cities`, `tags`, `disclaimers` |
| `profiles` | `list`, `create`, `update`, `orders`, `order-items`, `campaigns` |
| `products` | `get`, `listings`, `categories` |
| `teams` | `list` |
| `articles` | `get`, `upload-own-article`, `submit` |
| `files` | `upload` (multipart) |
| `attachments` | `create` |

Every list/get supports `--format ascii|json|csv|markdown` and `--output <file>`.

## Publishing a placement

The `articles`, `files`, `attachments`, and `campaigns upload-content` commands
cover the team-scoped publishing flow (the endpoints live under
`/teams/:slug/...`). Resolve `:slug` once via `teams list` (map it from the
`team_id` that `whoami` shows). A typical run, given a chosen product, a Google
Doc, and image files:

```sh
SLUG=$(presscart teams list --format json | jq -r '.[0].slug')
# 1. create the (unpaid) order
presscart orders checkout --file order.json --format json          # -> order.id
# 2. find the auto-created article id for the order's line item
presscart orders items --format json                               # -> article_id
# 3. attach the customer's Google Doc (share it "Anyone with the link -> Editor")
presscart articles upload-own-article "$SLUG" "$ARTICLE_ID" \
  --source google_doc --google-doc-url "$DOC_URL"
# 4. upload the images, then link them to the article
FILE_IDS=$(presscart files upload "$SLUG" --file a.png b.png c.png --format json | jq -r '[.files[].id]|join(",")')
presscart attachments create --file-ids "$FILE_IDS" \
  --resource-type article_photo --resource-id "$ARTICLE_ID"
# 5. (after the order is PAID and reviewed) submit
presscart articles submit "$SLUG" "$ARTICLE_ID" \
  --action pending-publishing --feedback "Ready to publish"
```

Payment is intentionally not automated: `orders checkout` returns an order in
`CREATED` status (with a Stripe `client_secret` / `checkout_link`) unless it is
covered by Team Credits. Pay and review in the app, then submit.

`files upload` strips image provenance metadata (EXIF/XMP and C2PA Content
Credentials) by default — a lossless, pure-JS byte-level strip for JPEG/PNG/WebP,
so uploaded AI images don't carry "made by ChatGPT/Gemini" markers. Pass
`--no-strip-metadata` to keep it. (Invisible watermarks like SynthID are not
metadata and are not removed.)

## Marketplace budget filters

`outlets list` and `products listings` support `--min-price <usd>` and
`--max-price <usd>`. These filters are client-side because Presscart does not
expose server-side price filtering. `unit_amount` is whole USD, not Stripe
cents, so `775` means `$775`.

`outlets list` also supports `--all`, which follows pagination through every
page, capped at 100 pages for safety, adds a `price_usd` column, and writes a
summary to stderr so `--format json|csv` stdout stays pipeable.

## Programmatic use

```ts
import { buildProgram, ApiClient, loadSession } from "@mirage-cli/presscart-cli";

const program = buildProgram();
await program.parseAsync(["node", "presscart", "campaigns", "list", "--format", "json"]);

const session = loadSession();
if (session) {
  const client = new ApiClient(session);
  const campaigns = await client.request<{ data: unknown[] }>("/campaigns");
}
```

Drop-in for mirage: see `@mirage-cli/presscart`.
