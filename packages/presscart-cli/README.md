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

Every list/get supports `--format ascii|json|csv|markdown` and `--output <file>`.

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
