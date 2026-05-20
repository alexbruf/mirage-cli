# ahrefs-cli

CLI **and** programmatic library for the [Ahrefs API v3](https://docs.ahrefs.com/en/api/docs/introduction). Maps cleanly to the web UI. Outputs in colored tables, JSON, or CSV. Command shape is structurally compatible with [`@struktoai/mirage-core`](https://www.npmjs.com/package/@struktoai/mirage-core) — commands authored here can be lifted into a Mirage workspace without rewrite.

```
$ ahrefs keywords overview --select "keyword,country,volume,difficulty,cpc" "vegan protein"
  keyword         country   volume    difficulty   cpc
  vegan protein   us        74,000    58           $2.10
```

## Install

```sh
git clone git@github.com:alexbruf/mirage-cli.git
cd mirage-cli
bun install
bun run --filter ahrefs-cli build
ln -sf "$PWD/packages/ahrefs-cli/dist/cli.js" /usr/local/bin/ahrefs   # or anywhere on $PATH
```

Or if you're consuming it programmatically in another project:

```sh
bun add ahrefs-cli
```

## Auth

Create an API v3 key at <https://app.ahrefs.com/account/api-keys> (scope: **API v3**, not MCP). Then either drop it in `.env`:

```sh
echo "AHREFS_API_KEY=your_key_here" > .env
```

…or export it in your shell, or pass `--api-key <key>` per-command. Verify:

```sh
ahrefs account limits
```

## Usage

```sh
bun run src/cli.ts <section> <command> [args] [flags]
```

Sections mirror the Ahrefs web UI:

| Section | Commands |
|---|---|
| `site-explorer` | overview, backlinks, refdomains, organic-keywords, organic-competitors, top-pages, anchors, ... |
| `keywords` | overview, matching-terms, related-terms, search-suggestions, volume-history, volume-by-country |
| `rank-tracker` | overview, serp-overview, competitors-overview, competitors-pages, competitors-stats |
| `site-audit` | projects, issues, page-content, page-explorer |
| `batch-analysis` | (top-level: `ahrefs batch-analysis ...`) |
| `gsc` | keywords, pages, performance-history, ... |
| `account` | limits |

Run `ahrefs <section> --help` to list commands. Run `ahrefs <section> <command> --help` for full per-flag documentation pulled straight from the Ahrefs OpenAPI spec — including types, enum values, defaults, and descriptions.

## Output formats

- **Table** (default) — colored, aligned, ergonomic.
- `--json` — raw API response, composable with `jq`.
- `--csv` — header + rows, pipe-friendly.

## Useful global flags

- `--cache 1h` — cache GET responses on disk (`~/.cache/ahrefs-cli/`) for the given duration. Big deal because every call costs Ahrefs API units.
- `--explain` — print the equivalent `curl` command to stderr before calling.
- `--select col1,col2,...` — override the default column set for any list endpoint. Affects unit cost.

## Help is the source of truth

The CLI's help text is generated from a bundled snapshot of the Ahrefs OpenAPI spec (`openapi/ahrefs.json`), crawled from `docs.ahrefs.com`. To refresh:

```sh
bun run tools/build-spec.ts        # re-crawl spec
bunx openapi-typescript openapi/ahrefs.json -o src/generated/api-types.ts
```

## Programmatic use

Same command definitions power the CLI and the library. Call them in-process via `invoke()` — no subprocess.

```ts
import { invoke, keywordsOverviewCmd } from "@mirage-cli/ahrefs-cli";

const { text, result } = await invoke(keywordsOverviewCmd, {
  flags: { country: "us", json: true },
  texts: ["vegan protein"],
});
console.log(text);
console.log("exit:", result.exitCode);

// Or pass argv tokens, like the CLI would receive
await invoke(keywordsOverviewCmd, ["--country", "us", "--json", "vegan protein"]);
```

For raw API access (without a command's flag-parsing layer):

```ts
import { request } from "@mirage-cli/ahrefs-cli";

const data = await request({
  path: "/keywords-explorer/overview",
  query: { select: "keyword,volume,difficulty", country: "us", keywords: "vegan protein" },
});
```

## Claude Code skill

A short "want X → run Y" reference lives at `skills/ahrefs/SKILL.md`. To make Claude Code see it across sessions, symlink it into `~/.claude/skills/`:

```sh
ln -s "$(pwd)/skills/ahrefs" ~/.claude/skills/ahrefs
```

Full per-flag docs stay in `ahrefs <cmd> --help`.

## License

MIT.
