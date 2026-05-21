---
"@mirage-cli/core": minor
"@mirage-cli/firecrawl": minor
"@mirage-cli/dataforseo": minor
"@mirage-cli/dataforseo-cli": minor
"@mirage-cli/ahrefs": minor
"@mirage-cli/ahrefs-cli": minor
"@mirage-cli/reddit": minor
"@mirage-cli/reddit-cli": minor
"@mirage-cli/radar": minor
"@mirage-cli/radar-cli": minor
"@mirage-cli/pulse": minor
"@mirage-cli/pulse-cli": minor
"@mirage-cli/presscart": minor
"@mirage-cli/presscart-cli": minor
"@mirage-cli/clarity": minor
"@mirage-cli/clarity-cli": minor
"@mirage-cli/seogets": minor
"@mirage-cli/seogets-cli": minor
"@mirage-cli/ga4": minor
"@mirage-cli/ga4-cli": minor
---

Initial public release of `@mirage-cli/*` — a monorepo of Commander.js CLIs (and importable mirage / Cloudflare-Worker wrappers) for SEO, analytics, and growth tooling.

**Packages**:

- `@mirage-cli/core` — in-process Commander runner. Captures stdout / stderr / exit code from any `commander` program and adapts it to mirage's `CommandFn` interface. Runs in Node, Bun, and Cloudflare Workers (`nodejs_compat`).
- `@mirage-cli/firecrawl` — wraps the published `firecrawl-cli`.
- `@mirage-cli/ahrefs-cli` + `@mirage-cli/ahrefs` — Ahrefs Data API.
- `@mirage-cli/dataforseo-cli` + `@mirage-cli/dataforseo` — DataForSEO API.
- `@mirage-cli/reddit-cli` + `@mirage-cli/reddit` — `reddit.viewengine.ai`. Auth: Clerk OAuth (PKCE loopback) or `REDDIT_API_KEY` bearer.
- `@mirage-cli/radar-cli` + `@mirage-cli/radar` — `radar.viewengine.ai`. Auth: `RADAR_OAUTH_ACCESS_TOKEN`.
- `@mirage-cli/pulse-cli` + `@mirage-cli/pulse` — `pulse.viewengine.ai`. Auth: `PULSE_OAUTH_ACCESS_TOKEN`.
- `@mirage-cli/presscart-cli` + `@mirage-cli/presscart` — `api.presscart.com`. Auth: `PRESSCART_API_TOKEN`.
- `@mirage-cli/clarity-cli` + `@mirage-cli/clarity` — Microsoft Clarity MCP + Data Export. Auth: `CLARITY_API_TOKEN`.
- `@mirage-cli/seogets-cli` + `@mirage-cli/seogets` — SEO Gets MCP (JSON-RPC over Streamable HTTP). Auth: `SEOGETS_MCP_TOKEN`.
- `@mirage-cli/ga4-cli` + `@mirage-cli/ga4` — Google Analytics 4 Data + Admin APIs. **Fetch-only, no gRPC** (forked from Bin-Huang/google-analytics-cli, transport replaced for Workerd compatibility). Service-account JWT signed via Web Crypto. Auth: OAuth, service-account JSON, or `GA4_OAUTH_ACCESS_TOKEN`.

Each `@mirage-cli/<vendor>-cli` package is a standalone Commander CLI you can `bun add -g`. Each `@mirage-cli/<vendor>` wrapper exports `buildProgram()` and a ready-made `MirageCommandFn` for embedding into mirage runtimes or Cloudflare Workers.
