---
name: dataforseo
description: Query the DataForSEO API via the `dfs` CLI. Use when the user asks for keyword research, search volume, SERP analysis (Google organic/maps/news/images, YouTube), backlink audits, competitor / gap analysis, ranked-keywords for a domain, keyword difficulty, search intent, historical rankings, Google Trends, AI visibility (LLM mentions, top pages/domains cited by ChatGPT/Claude/Gemini/Perplexity, AI-tool search volume), or any DataForSEO data. The CLI ships curated commands for ~40 high-value endpoints plus a `dfs raw` escape hatch that hits any of the 437 endpoints by path. Output defaults to JSON for piping into `jq`. Triggers include "search volume", "keyword ideas", "SERP for", "ranked keywords", "backlinks for", "referring domains", "competitor analysis", "domain rank overview", "keyword difficulty", "search intent", "google trends", "LLM mentions", "AI search volume", "top pages cited by AI", or any reference to DataForSEO.
---

# DataForSEO CLI Skill

This skill drives the `dfs` CLI (https://github.com/alexbruf/mirage-cli/tree/main/packages/dataforseo-cli). The CLI wraps the DataForSEO REST API with curated commands and a raw escape hatch.

## Setup check

Run once per machine to confirm the CLI is installed and authed:

```bash
dfs whoami
```

If that fails:
- Install: clone https://github.com/alexbruf/mirage-cli, then from `packages/dataforseo-cli/` run `bun install && bun run build && ln -sf "$PWD/dist/dfs.js" /usr/local/bin/dfs` (or `bun run compile` for a standalone binary).
- Auth: `dfs login --login <email> --password <api_password>` (verifies and stores creds at `~/.config/dataforseo/config.json` chmod 600). Or set `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` env vars.

## Output convention

Every data command supports:
- `-o json` (default) — JSON for piping into `jq`
- `-o ndjson` — one row per line
- `-o table` — pretty table for human inspection
- `-o csv` — CSV for spreadsheets
- `--full` — emit the entire DataForSEO response, not just `tasks[*].result[*].items`
- `--columns col1,col2` — select columns for `table` / `csv`

Cost is printed to stderr after each call. Pipe stderr away (`2>/dev/null`) when you only want data.

## Curated commands

Each lives under a top-level group. Every command takes `--location <name>` / `--language <name>` (or `--location-code` / `--language-code`) where applicable; defaults are United States / English.

### keywords — search volume, ideas, ranked
```bash
dfs keywords search-volume "seo tools" "keyword research" -o table
dfs keywords ideas "seo tools" --limit 200 -o csv > ideas.csv
dfs keywords suggestions "seo tools" --limit 50
dfs keywords ranked example.com --limit 500 -o csv > ranked.csv
```

### serp — Google / YouTube SERPs
```bash
dfs serp google organic "best running shoes" --advanced --device mobile
dfs serp google maps "coffee shops near soho london" --location "London,England,United Kingdom"
dfs serp google news "anthropic claude" --depth 20
dfs serp google images "minimalist desk setup"
dfs serp youtube organic "claude code tutorial"
```

### backlinks — profile, list, referring domains, anchors
```bash
dfs backlinks summary example.com -o table
dfs backlinks list example.com --limit 500 --mode one_per_domain -o csv > links.csv
dfs backlinks referring-domains example.com --limit 200
dfs backlinks anchors example.com --limit 100
dfs backlinks competitors example.com --limit 50
dfs backlinks ranks example.com competitor.com other.com
```

### labs — competitors, gap, keyword overview, intent, historical
```bash
dfs labs competitors example.com --limit 50 -o table
dfs labs intersection example.com competitor.com --limit 200 -o csv > gap.csv
dfs labs overview example.com -o table
dfs labs related "seo tools" --limit 100
dfs labs keyword-overview "seo tools" "ai search" --include-serp-info -o table
dfs labs bulk-difficulty "seo tools" "ai search" "keyword research"  # up to 1000 kws
dfs labs intent "buy nike shoes" "how to tie shoelaces" -o table --columns keyword,keyword_intent
dfs labs top-searches --location "United States" --limit 50
dfs labs historical example.com -o json
```

### ai — AI visibility (LLM mentions, AI search volume, LLM proxy)
```bash
dfs ai search-volume "seo tools" "keyword research"           # how often a kw is typed at LLMs
dfs ai mentions "anthropic" "claude code"                     # LLM mentions of target keywords
dfs ai top-pages "claude code" -o table                       # pages most cited by AI
dfs ai top-domains "claude code" -o table                     # domains most cited by AI
dfs ai metrics "claude code" -o json                          # aggregated mention metrics
dfs ai ask "summarize the latest Claude release" --model claude --max-tokens 400
```

`--model` accepts `chatgpt | claude | gemini | perplexity`. Costs vary per model.

### trends — Google Trends + DataForSEO Trends
```bash
dfs trends explore "chatgpt" "claude" --date-from 2026-01-01 --date-to 2026-05-01
dfs trends explore "anthropic" --type news      # web | news | youtube | images | shopping
dfs trends demography "chatgpt" -o table
dfs trends subregion "chatgpt" -o table
```

### locations / languages / user — metadata
```bash
dfs locations --api serp/google -o table | head -20
dfs languages --api keywords_data/google_ads
dfs user                # remaining balance, plan
```

## Raw escape hatch (for the other ~390 endpoints)

When no curated command fits — on-page audits, Lighthouse, WHOIS, App Store, Amazon Products, async task flows, etc. — hit the endpoint directly. Discover it first:

```bash
dfs endpoints tags                         # how many endpoints per tag
dfs endpoints list --tag OnPage
dfs endpoints show on_page/instant_pages   # description, doc URL, example body
```

Then call it. Three ways to supply the body:

```bash
# Inline JSON object (auto-wrapped as [task] for POST endpoints)
dfs raw on_page/instant_pages \
  -d '{"url":"https://example.com/some-page","browser_preset":"desktop"}'

# Key/value shorthand (with type coercion: numbers, booleans, JSON arrays/objects)
dfs raw serp/google/organic/live/advanced \
  --kv keyword="best laptops" location_code=2840 language_code=en device=mobile depth=50

# JSON file (or stdin with -)
echo '[{"keyword":"seo","location_code":2840,"language_code":"en"}]' \
  | dfs raw serp/google/organic/live/regular -f -

# Use the spec's example body verbatim — handy for checking an endpoint works
dfs raw serp/google/organic/live/regular --example
```

## Common request patterns

**Striking-distance keywords for a domain (positions 4–15):**
```bash
dfs keywords ranked example.com --limit 1000 -o json \
  | jq '.[] | select(.ranked_serp_element.serp_item.rank_group >= 4 and .ranked_serp_element.serp_item.rank_group <= 15)'
```

**Bulk KD for a list of seed keywords (CSV in, CSV out):**
```bash
cat seeds.txt | xargs dfs labs bulk-difficulty -o csv > kd.csv
```

**AI visibility quick-check for a brand:**
```bash
dfs ai top-domains "<brand or category>" -o table --columns domain,mentions_count,share
dfs ai top-pages "<brand or category>" -o csv > ai-citations.csv
```

**Cost-conscious exploration:** Live methods cost more than Standard/Task methods. Check a curated command's underlying endpoint with `dfs endpoints show <path>` and consider the `task_post` variant for batch/cheaper runs.

## Caveats

- DataForSEO POST endpoints take an array of task objects. The CLI auto-wraps a single task object as `[task]`; pass `--no-wrap` (raw command) to disable.
- Errors arrive as `status_code` / `status_message` inside the response. The CLI throws on HTTP errors; check stderr.
- `tasks_ready` / `tasks_get` flows aren't curated yet — use `dfs raw` to drive them.
- `dfs ai ask` is a metered LLM proxy — each call costs DataForSEO credits per model.
