# @mirage-cli/rapidurlindexer-cli

Typed, fetch-only client and Commander CLI for the official [Rapid URL Indexer REST API](https://rapidurlindexer.com/indexing-api/). It creates indexing projects, tracks their long-running status, retrieves per-URL reports, and checks account credits.

```sh
bun add -g @mirage-cli/rapidurlindexer-cli
rapidurlindexer --help
```

## Authentication

Get the API key from the Rapid URL Indexer "My Projects" dashboard, then set:

```sh
export RAPIDURLINDEXER_API_KEY=your-key
```

`--api-key` overrides the environment. `RAPID_URL_INDEXER_API_KEY` is also accepted as a compatibility alias. Production requests use `https://rapidurlindexer.com/wp-json`; `--base-url` or `RAPIDURLINDEXER_API_BASE_URL` can override it for testing.

## Commands

```sh
rapidurlindexer credits balance
rapidurlindexer projects list
rapidurlindexer projects get <project-id>
rapidurlindexer projects create --name <name> --url https://example.com/page
rapidurlindexer projects create --name <name> --urls-file urls.txt
rapidurlindexer projects report <project-id>
rapidurlindexer projects report <project-id> --format csv
```

Repeat `--url` to add inline URLs. `--url` and `--urls-file` can be combined. Input is trimmed, validated, deduplicated in first-seen order, and capped at the API maximum of 9,999 URLs. URL files are newline-delimited; blank lines and lines beginning with `#` are ignored. Files are capped at 16 MiB and must be regular files outside Mirage. Mirage VFS paths such as `/sessions/...` and `/data/...` use the `__MIRAGE_CLI_FILE_IO__` bridge.

`projects create` is a credit-spending write and is never automatically retried. Optional flags:

- `--notify`: request status-change emails.
- `--apex`: enable Apex Mode, which costs 3 credits per URL.

## Output and errors

Success output is compact JSON by default and can be formatted with `--pretty`. Reports default to JSON; `--format csv` passes through the API's CSV report. Errors are JSON on stderr with `error`, `status`, `kind`, and an actionable `hint` when available.

The client distinguishes:

- 401 and API-key-related 403 responses as `authentication`.
- Other 403 responses, including insufficient credits, as `forbidden`.
- 425 reports as `not_ready`; reports normally become available after 96 hours.
- 429 responses as `rate_limited`, including `retry_after_seconds` when supplied.

Rapid URL Indexer documents a limit of 100 requests per minute per API key. Project-level terminal states are `completed`, `failed`, and `refunded`. Initial reports arrive around day 4; final results and standard credit refunds are processed around day 14. See the official [platform workflow](https://rapidurlindexer.com/documentation/).

## Library use

```ts
import { RapidUrlIndexerClient } from "@mirage-cli/rapidurlindexer-cli";

const client = new RapidUrlIndexerClient({ apiKey: process.env.RAPIDURLINDEXER_API_KEY! });
const created = await client.createProject({
  project_name: "release-2026-07-14",
  urls: ["https://example.com/new-page"],
});
const status = await client.getProject(created.project_id);
```

The typed client uses only standard `fetch`. Filesystem access exists only in the explicit CLI URL-file helper and checks the Mirage VFS bridge before dynamically loading the local Node filesystem fallback.
