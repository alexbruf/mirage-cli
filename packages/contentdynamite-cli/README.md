# @mirage-cli/contentdynamite-cli

Typed Content Dynamite API client and CLI (`ve-dynamite`) for SEO articles, BOFU landing pages, company profiles, ICP, and featured images. A from scratch TypeScript port of the product's Python CLI, wrapping `https://api.dynamate.ai/api/v1`.

## Install

```bash
bun add @mirage-cli/contentdynamite-cli
```

The standalone binary is `ve-dynamite` (`bunx ve-dynamite --help`).

## Authenticate

Resolution order: `--token` flag, then `VE_DYNAMITE_TOKEN`.

```bash
export VE_DYNAMITE_TOKEN=ved_...
```

Mint a long lived `ved_` token once with `ve-dynamite tokens create --name my-runtime` (using a 24h JWT from the product login to bootstrap). There is no `login` command and no on disk credential store in this port; the token always comes from the flag or the environment. `VE_DYNAMITE_API_URL` (or `--url`) overrides the production base URL.

## Commands

| Group | Commands |
|---|---|
| root | `whoami`, `upload <file> --type image\|csv` |
| `tokens` | `create --name [--expires-days]`, `list`, `revoke <id>` |
| `profiles` | `create`, `list`, `get <id>`, `update <id>`, `delete <id> --yes` |
| `icp` | `show <profile-id>`, `regenerate <profile-id>`, `update <profile-id>` |
| `categories` | `list <profile-id>`, `add <profile-id> <names...>` |
| `articles` | `write`, `get <id>`, `list`, `update <id>`, `delete <id> --yes`, `export` |
| `batches` | `create --name (--csv\|--jobs)`, `list`, `get <id>`, `delete <id> --yes` |
| `landing-pages` | `write`, `get <id>`, `list`, `update <id>`, `fix-images [--dry-run]`, `delete <id> --yes`, `export --html\|--copy` |
| `images` | `edit <article-id>`, `status <article-id> <job-id>`, `commit <article-id>` |

Deliberately not ported from the Python CLI: `login`, `logout`, `tokens use` (interactive credential storage) and every `watch` subcommand (unbounded poll loops do not fit a Worker request lifetime; poll `get` instead).

## Money and wire contract

- `articles write`, `batches create`, `landing-pages write`, `landing-pages fix-images`, `icp regenerate`, `profiles create`, and `images edit` spend real money per item and are never automatically retried. Billable calls report `reportCost({ provider: "contentdynamite" })` telemetry.
- A completed article reports the wire status `"sucess"` (sic); landing pages use the correct `"success"`. The CLI accepts `success` everywhere and maps it per surface.
- `images status` is one shot: the server forgets a job after its first terminal read, so save the output.
- The client never follows redirects (multipart bodies must not be resent through a 307) and sends `upload` `file_type` as a query param.

## Output and errors

Success output is JSON on stdout (`--pretty` to indent). Errors are a single JSON object on stderr and exit code 1:

| Status | kind | hint |
|---|---|---|
| 401 | `authentication` | check `VE_DYNAMITE_TOKEN` or pass `--token` |
| 403 | `forbidden` | the token lacks permission |
| 404 | `not_found` | |
| 409 | `conflict` | the resource is still generating, retry once it settles |
| 422 | `validation` | FastAPI field errors, joined |
| 429 | `rate_limited` | retry later |
| 5xx | `server` | |

## Library use

```ts
import { ContentDynamiteClient } from "@mirage-cli/contentdynamite-cli";

const client = new ContentDynamiteClient({ token: process.env.VE_DYNAMITE_TOKEN! });
const profiles = await client.get("company-profile/");
```

## Worker compatibility

Pure fetch. No Node only imports at load time: file flags (`--csv`, `--jobs`, `--body-file`, `--writing-guide-file`, `-o`) read through the Mirage VFS bridge (`globalThis.__MIRAGE_CLI_FILE_IO__`) when present and only fall back to a dynamic `node:fs` import on a real Node runtime. Runs unchanged under workerd `nodejs_compat`.
