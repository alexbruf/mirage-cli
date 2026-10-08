# @mirage-cli/mobbin-cli

CLI for [Mobbin](https://mobbin.com), the library of real app and website UI. It drives Mobbin's MCP server (`https://api.mobbin.com/mcp`), so the three searches an agent gets over MCP work from a shell, and results can be saved as image files.

```bash
bunx @mirage-cli/mobbin-cli login                                   # browser sign-in, once
mobbin screens checkout with apple pay button --platform ios        # single screens
mobbin flows duolingo onboarding --platform ios --limit 3           # multi-step flows
mobbin sections pricing with three tiers --save ./refs              # website sections, images saved
```

## Sign-in

`mobbin login` runs OAuth 2.1 with PKCE through your browser. It needs a Mobbin **Pro, Team or Enterprise** plan. The authorization server is found by MCP discovery (the endpoint's protected-resource metadata), and the CLI registers itself as a public client through Dynamic Client Registration the first time; the client id is kept for later sign-ins.

**Browser on another machine (SSH, a remote dev box)?** The browser ends on a `http://127.0.0.1:.../callback?code=...` page that does not load. Copy that address, paste it into the waiting `mobbin login`, and press Enter. Add `--no-browser` to skip opening one.

**You sign in once.** Access tokens last an hour and are refreshed silently. The refresh token rotates on every use and is saved each time. `mobbin logout` forgets the session locally; Mobbin has no revocation endpoint, so remove access in Mobbin's settings ([how](https://docs.mobbin.com/mcp/disconnect)).

## Commands

| Command | What it does |
| --- | --- |
| `screens <query...> --platform ios\|web` | Single screens. `--mode deep` (default, AI re-ranked) or `standard` (faster); `--limit` 1-30; `--exclude id,id` for a next batch |
| `flows <query...> --platform ios\|web` | Multi-step flows. `--limit` 1-10, `--page` 1-20 |
| `sections <query...>` | Website sections (pricing, hero, footer...). `--limit` 1-30, `--page` |
| `download <image_url> <path>` | Save one result's image |
| `login`, `logout`, `status` | Session |
| `tools`, `call <tool> [json]` | Any MCP tool, raw |

Every search takes:

- `--save <dir>`: download the high-resolution images (1920px wide) into `<dir>`. Flows save one folder per flow, one numbered file per screen. Mobbin's `image_url` links expire after 30 days, so save what you want to keep and cite `mobbin_url`.
- `--intent <sentence>`, `--destination code|design_tool|doc|reference_library|chat|other`, `--for <product>`: Mobbin's relevance hints. Keep them the same across every search in one task.
- `--json` (the full result, including `ai_usage_notice` when Mobbin sends one) or `--ndjson` (one result per line).

Query tips from Mobbin: describe one screen or one journey in plain words, be specific, name an app to filter to it ("Spotify now-playing screen"), and do not put the platform, negations or vague style words ("modern") in the query.

## Environment

| Variable | Purpose |
| --- | --- |
| `MOBBIN_ACCESS_TOKEN` | An OAuth access token to use instead of the saved login (for hosts that refresh per call; not refreshed here) |
| `MOBBIN_MCP_URL` | MCP endpoint (default `https://api.mobbin.com/mcp`) |
| `MOBBIN_CLI_CONFIG` | Config file path (default `~/.config/mobbin-cli/config.json`, mode 600) |

## Worker compatibility

Searches are `fetch` calls, and `--save` writes through the Mirage VFS bridge when a host installs one (`globalThis.__MIRAGE_CLI_FILE_IO__`), so `/data/...` paths work in a Mirage workspace. `login` and `logout` need a real filesystem and a loopback port; in a Worker, inject `MOBBIN_ACCESS_TOKEN`.
