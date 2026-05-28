# @mirage-cli/gbp-cli

A small CLI to query **Google Business Profile** data across many businesses.

Google's official GBP Performance API is gated behind an access-approval process.
This tool sidesteps that by reading the same data through the **Windsor.ai**
`google_my_business` connector — which has already cleared GBP API access — via
Windsor's REST API. The data layer is pluggable (`src/sources/`), so a direct
GBP Performance API backend can drop in later behind the same interface.

Every command is fetch-only, so the program is **workerd-safe** — no `node:fs`,
`node:http`, or interactive auth on any code path.

## Install

```bash
bun add @mirage-cli/gbp-cli
```

## Env vars

| Var               | Meaning                                                                            |
| ----------------- | ---------------------------------------------------------------------------------- |
| `WINDSOR_API_KEY` | Windsor.ai API key. Get one at <https://onboard.windsor.ai/app/data-preview>.      |

## Usage

```bash
gbp <command> [options]
```

### Commands

| Command            | What it returns                                                       |
| ------------------ | --------------------------------------------------------------------- |
| `businesses`       | Connected GBP locations (id + name)                                   |
| `metrics`          | Impressions, call/website/direction clicks, bookings (daily)          |
| `reviews`          | Reviews: rating, text, reviewer, your reply                           |
| `keywords`         | Search keywords used to find each business (+ monthly volume)         |
| `raw <f1,f2,...>`  | Any connector fields (see `gbp fields`)                               |
| `fields`           | List all available connector fields                                   |

### Options

Data commands (`metrics`, `reviews`, `keywords`, `raw`) **require a business** —
pass `-b` or `--all`. Selecting a business by name is forgiving: a case-insensitive
partial match is enough (`-b acme` → "Acme Roofing").

| Option                       | Meaning                                                       |
| ---------------------------- | ------------------------------------------------------------- |
| `-b, --business <name\|id>`  | Business to query — partial name, or `locations/...` id       |
| `--all`                      | Query every business (instead of `-b`)                        |
| `-s, --since <range\|date>`  | `30d` `12w` `6m` `1y` or `YYYY-MM-DD` (default `30d`)          |
| `-u, --until <date>`         | End date `YYYY-MM-DD` (with a `--since` date)                 |
| `-f, --format <fmt>`         | `table` (default) · `json` · `csv`                            |
| `-n, --limit <n>`            | Max rows                                                      |
| `--total`                    | `metrics`: sum per business instead of daily rows             |

### Examples

```bash
gbp businesses
gbp metrics -b acme --since 90d --total
gbp metrics --all --since 30d
gbp reviews -b "acme roofing" --since 6m --format csv > reviews.csv
gbp keywords -b acme --since 3m
gbp raw date,impressions_mobile_search -b acme -s 30d -f json
```

## Programmatic use

```ts
import { buildProgram } from "@mirage-cli/gbp-cli";

const program = buildProgram(); // a fresh Commander program, no parse side-effects
await program.parseAsync(["node", "gbp", "businesses"]);
```

For mirage / Cloudflare-Worker consumption, use the
[`@mirage-cli/gbp`](../gbp) wrapper instead — it surfaces `buildProgram` plus a
ready-made `gbpCommand` / `gbpResource`.

## License

MIT
