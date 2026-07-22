# @mirage-cli/seogets-cli

CLI for the [SEO Gets](https://seogets.com) MCP — typed Commander subcommands over the upstream MCP JSON-RPC server.

```
bun add -g @mirage-cli/seogets-cli
export SEOGETS_MCP_TOKEN=...

seogets tools                                         # list MCP tools
seogets sites                                         # GSC properties for this token
seogets gsc example.com 2026-04-01 2026-04-29 query,page
seogets gsc-top example.com 2026-04-01 2026-04-29 --dim query --by impressions -n 10 --format json
seogets gsc-compare example.com --query "roof repair" --current-start 2026-04-16 --current-end 2026-04-29 --compare-start 2026-04-02 --compare-end 2026-04-15
seogets indexing overview example.com
seogets indexing status example.com --status "Crawled - currently not indexed"
seogets call get_gsc_performance '{"site":"example.com","start_date":"2026-04-01","end_date":"2026-04-29","dimensions":["query"]}'
```

## Auth

`SEOGETS_MCP_TOKEN` env var (required) — find it in your SEO Gets account under MCP/API settings.

Optional: `SEOGETS_MCP_URL` overrides the endpoint (default `https://app.seogets.com/mcp`).

Or pass `--token <token>` / `--url <url>` to any command.

## Transport

JSON-RPC 2.0 over Streamable HTTP. The endpoint returns SSE-encoded responses (`event: message` / `data: {...}`) — the CLI parses the `data:` line automatically.

## Output

Every command supports `-f, --format <fmt>` (`ascii` | `json` | `csv` | `markdown` | `ndjson`) and `-o, --output <file>`.

`get_gsc_performance` returns the whole window in a single response (no pagination —
the server rejects `page`/`page_size` and caps output at ~50,000 rows). `gsc-top`
ranks that full response before selecting rows, so sorting by impressions does not
omit zero-click queries. Its default rows-only output contains only the requested
dimension and metric, with no MCP metadata wrapper. Use `--no-rows-only` to retain
every upstream column. A `# warning` is printed to stderr when a response hits the
server row cap.

`gsc-compare` finds one exact query across two windows and returns its current value,
prior value, absolute and percentage deltas, and explicit found flags.

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
