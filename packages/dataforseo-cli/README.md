# dataforseo-cli

`dfs` — an ergonomic CLI **and** a programmatic library for the DataForSEO API.

- Curated commands cover ~30 high-value endpoints.
- `dfs raw` escape hatch hits any of the 437 endpoints by path (driven off the official OpenAPI spec, slimmed at build time to a 327 KiB JSON index).
- Same command definitions are exported as a library — the `command()` factory and `CommandSpec` / `Option` / `Operand` / `OperandKind` / `IOResult` shapes match `@struktoai/mirage-browser`, so a command authored here can be lifted into a mirage workspace later without rewrite.

Bun + TypeScript. Companion Claude Code skill in `skill/`.

## Install

```bash
bun install
bun run build
ln -sf "$PWD/dist/dfs.js" /usr/local/bin/dfs

# Or compile a standalone binary:
bun run compile && cp bin/dfs /usr/local/bin/dfs
```

## Auth

```bash
dfs login --login you@example.com --password <api_password>
# or
export DATAFORSEO_LOGIN=you@example.com
export DATAFORSEO_PASSWORD=...
```

Credentials are written to `~/.config/dataforseo/config.json` (chmod 600).

## Quick tour

```bash
dfs whoami
dfs user

# keyword research
dfs keywords search-volume "seo tools" "keyword research" -o table
dfs labs bulk-difficulty "seo tools" "ai search" "claude code"
dfs labs intent "buy nike shoes" "how to tie shoelaces" -o table
dfs keywords ranked example.com --limit 500 -o csv > ranked.csv

# SERPs
dfs serp google organic "best running shoes" --advanced --device mobile
dfs serp google news "anthropic claude"
dfs serp google images "minimalist desk"

# backlinks + gap
dfs backlinks summary example.com -o table
dfs labs competitors example.com --limit 50
dfs labs intersection example.com competitor.com --limit 200

# AI visibility (LLM mentions, top-cited pages/domains, AI search volume)
dfs ai top-domains "claude code" -o table
dfs ai search-volume "seo tools" "keyword research"
dfs ai ask "summarize the latest Claude release" --model claude

# trends
dfs trends explore "chatgpt" "claude" --date-from 2026-01-01
```

## Discovering endpoints

```bash
dfs endpoints tags
dfs endpoints list --tag KeywordsData -q trends
dfs endpoints show keywords_data/google_trends/explore/live
```

## Raw escape hatch

```bash
# Curated command doesn't exist? Hit the endpoint directly.
dfs raw keywords_data/google_trends/explore/live \
  -d '{"keywords":["seo","sem"],"location_code":2840}'

# Key/value shorthand:
dfs raw serp/google/organic/live/advanced \
  --kv keyword="best laptops" location_code=2840 language_code=en device=mobile

# Use the OpenAPI spec's example body:
dfs raw serp/google/organic/live/regular --example
```

## Output

Every data command supports `-o json|ndjson|table|csv|raw` and `--columns col1,col2`. Cost is printed to stderr.

## Programmatic use

The package exports three layers — pick whichever fits.

**1. Plain async functions** — typed wrappers, return the raw `DfsResponse`:

```ts
import { keywordsSearchVolume } from 'dataforseo-cli'

const resp = await keywordsSearchVolume({
  keywords: ['seo tools', 'keyword research'],
  locationName: 'United States',
})
```

**2. Mirage-shaped command definitions** — call them via `invoke()` for CLI-style argument parsing without spawning a subprocess:

```ts
import { invoke, keywordsSearchVolumeCmd } from 'dataforseo-cli'

const { text, result } = await invoke(keywordsSearchVolumeCmd, {
  texts: ['seo tools'],
  flags: { location: 'United States', output: 'table' },
})
console.log(text)
console.log(`exit: ${result.exitCode}`)

// Or pass argv tokens, like the CLI would receive:
await invoke(keywordsSearchVolumeCmd, ['--location', 'United States', 'seo tools'])
```

**3. Author your own command using the same primitives** — same shape as `@struktoai/mirage-browser`:

```ts
import {
  command,
  CommandSpec,
  IOResult,
  Operand,
  OperandKind,
  Option,
  invoke,
} from 'dataforseo-cli'

const greet = command({
  name: 'greet',
  spec: new CommandSpec({
    description: 'Print hello <name>.',
    options: [new Option({ short: 'u', long: 'upper', description: 'shout it' })],
    positional: [new Operand({ kind: OperandKind.TEXT, name: 'name' })],
  }),
  async fn(parsed) {
    const name = parsed.texts[0] ?? 'world'
    const upper = parsed.flag('upper', false) === true
    const msg = upper ? `HELLO ${name.toUpperCase()}!\n` : `hello ${name}\n`
    return [new TextEncoder().encode(msg), new IOResult({ exitCode: 0 })]
  },
})

await invoke(greet, { texts: ['alex'], flags: { upper: true } })
```

To plug your own commands into the CLI, import `toCommander(cmd)` and add the resulting `Command` to your commander program.

## Refresh the spec

When DataForSEO ships new endpoints:

```bash
bun run spec:refresh
```

Pulls the latest `openapi_specification.yaml` from `dataforseo/OpenApiDocumentation`.

## Companion Claude skill

Drop `skill/` into `~/.claude/skills/dataforseo` (or your skill manager) — it teaches Claude when to reach for `dfs` and how to use the curated commands + raw escape hatch.

## License

MIT
