# @mirage-cli/contentdynamite-cli

`ve-dynamite`, the Content Dynamite CLI: SEO articles, Google Business Profile posts, BOFU landing pages, company profiles, ICP, design systems, part-by-part revisions and featured images, over the Content Dynamite `/api/v1` JSON API. It talks to `https://content-dynamite.alexthecomputer1.workers.dev` unless `--url` or `VE_DYNAMITE_API_URL` names another host.

Stdout is always indented JSON, so pipe it to `jq`. Warnings, progress and hints go to stderr. The exit code is 0 on success and 1 on any error.

> **Money warning:** several commands spend real money (LLM, SERP, crawling, image credits) on every call, and nothing rate limits them. Their help says so and they print a warning when they run. Never script them in a loop.

## Install

```bash
npm i -g @mirage-cli/contentdynamite-cli    # or: bun add -g @mirage-cli/contentdynamite-cli
ve-dynamite --help
```

Runs on Node 18+ or bun. The only dependencies are `commander` and `zod`.

## Sign in

```bash
ve-dynamite login --email you@example.com --password <pw>   # stores a 24h JWT in ~/.config/ve-dynamite/
ve-dynamite whoami
ve-dynamite tokens create --name ci-runner [--expires-days 30]  # a long lived ved_ token for unattended use
ve-dynamite tokens use ved_xxxxxxxx
```

Or pass a token per call: `--token ved_xxx` or `VE_DYNAMITE_TOKEN=ved_xxx`. Precedence is `--token`, then `VE_DYNAMITE_TOKEN`, then the stored login. `VE_DYNAMITE_CONFIG_DIR` moves the stored login.

## Commands

| Group | Commands |
|---|---|
| root | `login`, `logout`, `whoami`, `upload <file> --type image\|csv` |
| `tokens` | `create`, `list`, `revoke <id>`, `use <token>` |
| `users` (admins) | `list`, `set-role <id> --role admin\|normal` |
| `profiles` | `create`, `list`, `get`, `update`, `delete` |
| `icp` | `show`, `export`, `regenerate`, `update` |
| `categories` | `list`, `add` |
| `design-system` | `show`, `set <profile-id> <zip>`, `rescan`, `clear` |
| `articles` | `write`, `research-prompt`, `get`, `list`, `watch`, `update`, `delete`, `download`, `export`, `parts`, `reject`, `revisions`, `provenance-audit`, `clean-provenance`, `embed-audit`, `strip-embeds` |
| `revisions` | `list`, `get`, `watch`, `verdict` |
| `batches` | `create`, `list`, `get`, `watch`, `delete` |
| `gbp` | `write`, `batch`, `list`, `get`, `watch`, `update`, `regenerate`, `delete`, `image-options` |
| `landing-pages` | `write`, `get`, `list`, `watch`, `update`, `delete`, `export`, `deck`, `versions`, `research`, `audit`, `reiterate`, `new-version`, `criteria`, `fix-placeholders`, `fix-images`, `rebrand` |
| `evals` | `run` |
| `images` | `edit`, `status`, `commit`, `watch` |

`ve-dynamite <group> <command> --help` documents every flag.

Paid, real money per item: `articles write|reject`, `articles clean-provenance --rewrite`, `batches create`, `gbp write|batch|regenerate`, `landing-pages write|reiterate|new-version|fix-images`, `profiles create`, `icp regenerate`, `design-system set|rescan`, `images edit`, `evals run --judge`.

Generation is asynchronous. A write returns an id at once; `watch` polls until it finishes, or poll `get` yourself about every 10 seconds. A completed article or landing page is `success`, a GBP post is `done`, a revision is `ready`.

## Running inside a host

`buildProgram(options)` returns an unparsed Commander program and `run(argv, options)` runs one command and returns its exit code:

```ts
import { buildProgram, run, type CostReport } from "@mirage-cli/contentdynamite-cli";

const program = buildProgram({ mount: true, reportCost: (report: CostReport) => record(report) });
const code = await run(["articles", "get", "41"], { mount: true });
```

`mount: true` is for agent hosts that inject the credential and the API host. It drops `login`, `logout`, `tokens use`, every `watch` and the `--url` flag, never reads or writes the stored login, takes the token only from `--token` or `VE_DYNAMITE_TOKEN`, requires `-o` on downloads, and words its hints for an agent that polls.

`reportCost` is called once the API accepts paid work, with `{ provider: "contentdynamite", units }`, where `units` is the number of paid jobs started. It is never called for a request the API refused.

File arguments and `-o` targets go through the Mirage VFS bridge (`globalThis.__MIRAGE_CLI_FILE_IO__`) when one is installed and claims the path, and otherwise through `node:fs`. For a Mirage mount, use [`@mirage-cli/contentdynamite`](../contentdynamite), which does all of this.

## Where the source lives

The CLI is developed next to the API in the Content Dynamite backend repository, which is private, and imports the API's own request schemas and response types so it cannot drift from it. `src/` here is generated from that repository by `bun run cli:mirage --out <this folder>`: the CLI files are copied as they are, the schemas and status helpers it uses are bundled into `src/wire.js`, and their types are written out flat to `src/wire.d.ts`. `src/source.json` names the commit it came from. Change the CLI there and regenerate, rather than editing `src/` by hand.
