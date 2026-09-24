# @mirage-cli/markup-cli

CLI for [ViewEngine Markup](https://markup.viewengine.dev): boards and annotations on live web pages. It drives the deployment's account-wide MCP endpoint (`/mcp`), so everything an agent can do over MCP, you can do from a shell.

```bash
bunx @mirage-cli/markup-cli login          # browser sign-in, once
markup boards                               # your saved boards
markup create https://example.com/pricing   # new board → share link
markup list <board>                         # annotations (board = link or id)
markup ack <board> <id>
markup reply <board> <id> "On it"
markup resolve <board> <id> --summary "Bumped to 48px"
markup watch <board> --follow               # stream new feedback
```

## Sign-in

`markup login` runs OAuth 2.1 with PKCE through your browser. It reuses Markup's magic-link login and asks you to approve the CLI. There is nothing to register: the CLI's `client_id` is the deployment's own metadata document (`<host>/cli/oauth-client.json`).

**Browser on another machine (SSH, a remote dev box)?** The browser ends on a `http://127.0.0.1:.../callback?code=...` page that does not load. Copy that page's address, paste it into the waiting `markup login`, and press Enter. Add `--no-browser` to skip trying to open one.

**You sign in once.** Access tokens last an hour and are refreshed silently. The refresh token rotates on every use and never expires. `markup logout` revokes it on the server.

## Commands

| Command | What it does |
| --- | --- |
| `login`, `logout`, `status`, `set-host <url>` | Session and host |
| `boards` | Boards saved to your account |
| `create <url>` | Open a board on a page, saved to your account |
| `info <board>`, `page <board>` | Board facts; outline of the annotated page |
| `list <board> [--status s]`, `get <board> <id>` | Read annotations |
| `watch <board> [--timeout s] [--follow]` | Wait for new or changed annotations |
| `comment <board> <text> --x --y` | Pin a comment |
| `suggest <board> <text> <replacement> --rect x,y,w,h` | Suggest a text edit |
| `ack`, `reply`, `resolve`, `dismiss` | Work an annotation |
| `tools`, `call <tool> [json]` | Any MCP tool, raw |

`<board>` accepts a share link (`https://markup.viewengine.dev/s/abc123`) or the bare id. Every command takes `--json` or `--ndjson`.

## Environment

| Variable | Purpose |
| --- | --- |
| `MARKUP_HOST` | Deployment URL (default `https://markup.viewengine.dev`) |
| `--as <name>` (flag) | Act as this name for one command; overrides `MARKUP_AGENT` |
| `MARKUP_AGENT` | Participant name shown on the board and recorded as the author of comments, replies and status changes (default `markup-cli`; trimmed, max 80 characters) |
| `MARKUP_TOKEN` | An OAuth access token to use instead of the saved login (for hosts that inject one per call; not refreshed) |
| `MARKUP_CLI_CONFIG` | Config file path (default `~/.config/markup-cli/config.json`, mode 600) |
