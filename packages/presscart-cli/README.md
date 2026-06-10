# @mirage-cli/presscart-cli

Presscart CLI — drives the `api.presscart.com` REST API.

```
bun add -g @mirage-cli/presscart-cli
presscart login --token pc_xxx_xxxxxxx_xxxxxxxx_xxxxxxxx
presscart campaigns list --format json
presscart outlets list --country US --limit 50
presscart products listings --channel facebook
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

Every list/get supports `--format ascii|json|csv|markdown` and `--output <file>`.

## Budget filtering on the marketplace

The Presscart API has **no server-side price filter**. `outlets list` and
`products listings` therefore accept client-side `--min-price` / `--max-price`
flags that filter the fetched page by each row's lowest `prices[].unit_amount`:

```
presscart outlets list --limit 500 --country US --max-price 500 --format json
```

Two things to know:

- **`unit_amount` is whole US dollars, not Stripe cents.** Apple News carries
  `unit_amount: 775`, meaning **$775** (not $7.75). `--max-price 500` keeps rows
  priced at $500 or less. Do not divide by 100.
- **The price filter applies to the current page only.** List responses default
  to a small page (25) and the API returns ~1,466 outlets total. Pass a large
  `--limit` and paginate with `--page` to budget-filter the whole catalog. Every
  list command prints a `# N shown … of M total — page X/Y` summary to **stderr**
  (stdout stays clean for piping) so you can see when more pages exist.

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
