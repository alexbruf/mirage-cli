---
"@mirage-cli/mobbin-cli": minor
"@mirage-cli/mobbin": minor
---

Add `@mirage-cli/mobbin` + `@mirage-cli/mobbin-cli`: a Mobbin CLI over Mobbin's MCP server (`https://api.mobbin.com/mcp`), built on the same plain-HTTP MCP client as `markup-cli`. Searches: `screens` and `flows` (both need `--platform ios|web`) and `sections`, each with `--save <dir>` to download the 1920px images through the Mirage VFS bridge or a local filesystem, Mobbin's relevance hints (`--intent`, `--destination`, `--for`), and `--json`/`--ndjson`. Plus `download`, `tools` and a raw `call <tool> [json]`. Tables print Mobbin's `ai_usage_notice` verbatim when it is sent.

Auth: `mobbin login` discovers the authorization server from the MCP endpoint's protected-resource metadata, registers a public client by Dynamic Client Registration once (kept in the config), and signs in with PKCE. Access tokens last an hour; the rotating refresh token is saved on every refresh. Hosts inject `MOBBIN_ACCESS_TOKEN` instead. Needs a Mobbin Pro, Team or Enterprise plan. Lockstep 0.1.0.
