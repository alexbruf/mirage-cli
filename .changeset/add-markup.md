---
"@mirage-cli/markup-cli": minor
"@mirage-cli/markup": minor
---

Add `@mirage-cli/markup` + `@mirage-cli/markup-cli` — a CLI for ViewEngine Markup (markup.viewengine.dev) that drives the deployment's account-wide MCP endpoint, so the CLI and agents share one backend. Commands: `boards`, `create <url>`, `info`, `page`, `list`, `get`, `watch [--follow]`, `comment`, `suggest`, `ack`, `reply`, `resolve`, `dismiss`, plus `tools` / `call <tool> [json]` as a raw escape hatch.

Sign-in is OAuth 2.1 + PKCE through the browser (`markup login`), reusing Markup's magic-link login; when the browser cannot reach the loopback (SSH, remote boxes), paste the callback URL into the terminal instead. The `client_id` is the deployment's Client ID Metadata Document, so there is no registration to expire, and refresh tokens rotate on use but never expire: one login lasts until `markup logout`, which revokes it server-side. Access tokens refresh silently a minute before expiry and once more on any 401. Hosts can inject `MARKUP_TOKEN` instead (used as-is, never refreshed).
