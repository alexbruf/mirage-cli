# @mirage-cli/seogets-cli

CLI for the [SEO Gets](https://seogets.com) MCP — typed Commander subcommands over the upstream MCP JSON-RPC server.

```
bun add -g @mirage-cli/seogets-cli
export SEOGETS_MCP_TOKEN=...

seogets tools                                         # list MCP tools
seogets sites                                         # GSC properties for this token
seogets gsc example.com 2026-04-01 2026-04-29 query,page
seogets perf example.com 2026-04-01 2026-04-29 date               # GSC + GA4 rows
seogets perf example.com 2026-04-01 2026-04-29 sessionSourceMedium --metrics sessions,keyEvents
seogets portfolio list
seogets portfolio perf "Roofing Sites" 2026-04-01 2026-04-29 site
seogets changes example.com --from 2026-04-01 --types content_changed,google_updates
seogets pages example.com --all --format csv
seogets queries example.com --page 2 --page-size 500
seogets groups example.com
seogets clusters example.com
seogets gsc-top example.com 2026-04-01 2026-04-29 --dim query --by impressions -n 10 --format json
seogets gsc-compare example.com --query "roof repair" --current-start 2026-04-16 --current-end 2026-04-29 --compare-start 2026-04-02 --compare-end 2026-04-15
seogets indexing overview example.com
seogets indexing status example.com --status "Crawled - currently not indexed"
seogets call get_site_performance '{"property":"example.com","start_date":"2026-04-01","end_date":"2026-04-29","dimensions":["query"]}'
```

## Auth

`SEOGETS_MCP_TOKEN` env var (required) — find it in your SEO Gets account under MCP/API settings.

Optional: `SEOGETS_MCP_URL` overrides the endpoint (default `https://app.seogets.com/mcp`).

Or pass `--token <token>` / `--url <url>` to any command.

## Transport

JSON-RPC 2.0 over Streamable HTTP. The endpoint returns SSE-encoded responses (`event: message` / `data: {...}`) — the CLI parses the `data:` line automatically.

## Output

Every command supports `-f, --format <fmt>` (`ascii` | `json` | `csv` | `markdown` | `ndjson`) and `-o, --output <file>`.

`get_site_performance` returns the whole window in a single response (no pagination —
the server rejects `page`/`page_size` and caps output at ~50,000 rows). `gsc-top`
ranks that full response before selecting rows, so sorting by impressions does not
omit zero-click queries. Its default rows-only output contains only the requested
dimension and metric, with no MCP metadata wrapper. Use `--no-rows-only` to retain
every upstream column. A `# warning` is printed to stderr when a response hits the
server row cap.

`gsc-compare` finds one exact query across two windows and returns its current value,
prior value, absolute and percentage deltas, and explicit found flags.

`gsc`, `gsc-top` and `gsc-compare` request search metrics only
(`clicks,impressions,ctr,position`). `gsc` keeps its raw envelope output for
compatibility.

### GSC + GA4: `perf` and `portfolio perf`

`perf` returns typed rows that join search metrics with GA4 metrics
(`activeUsers`, `sessions`, `engagedSessions`, `engagementRate`, `keyEvents`,
`revenue`) on the requested dimensions. Without `--metrics` the server returns
every metric the site has data for. GA4 has no query dimension, so grouping by
`query` returns search metrics only; `sessionSourceMedium` and `eventName` are
GA4-only dimensions. `--filters` takes a JSON array of
`{dimension, operator, expression}` filters.

`portfolio perf` does the same across a portfolio's sites (summed, with
impression-weighted position); add the `site` dimension for one row per site,
which compares the two sites of a migration. A note the server adds, such as a
GA4 failure or a skipped site, goes to stderr as `# ...`.

### Inventories and segments

`pages` and `queries` list everything with search data in the last 16 months,
1,000 rows per page by default. A `# more rows remain` warning goes to stderr
when there is another page; `--all` fetches every page. `groups` and
`clusters` list the content groups and topic clusters used as the
`contentGroup` and `topicCluster` dimensions.

### `changes`

One row per event on the content-change timeline: annotations, Google updates,
and (on SEO Gets super sites only) detected content edits, HTTP status changes,
internal link changes and tracking changes. Defaults to the last 28 days.

Every new command accepts `--raw` to emit the upstream envelope instead of rows.

### Errors

SEO Gets reports some failures (unknown property, unknown portfolio) as a
successful tool result carrying only a `note`. The CLI turns those into an
error and exit code 1. The rule is structural: a property- or portfolio-scoped
response is a failure when every field except `note` is null, empty, zero or
false. An empty but successful result always carries something else (an
echoed property, a result array, a page number).

## Programmatic use

```ts
import { buildProgram, McpClient } from "@mirage-cli/seogets-cli";

// CLI form
await buildProgram().parseAsync(["node", "seogets", "sites", "--format", "json"]);

// Direct MCP client
const c = new McpClient({ token: process.env.SEOGETS_MCP_TOKEN });
const sites = await c.callTool("list_sites", { filter: "all" });
```

Drop-in for mirage: see `@mirage-cli/seogets`.
