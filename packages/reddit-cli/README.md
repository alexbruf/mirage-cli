# @mirage-cli/reddit-cli

Reddit CLI — drives the `reddit.viewengine.ai` service.

```
bun add -g @mirage-cli/reddit-cli
reddit config set-host https://reddit.viewengine.ai
reddit login                       # Clerk OAuth (browser)
reddit hot programming -l 10
reddit search "rust" --sub rust
```

## Auth

Either:

- `REDDIT_API_KEY` env var — for headless / CI.
- `REDDIT_API_HOST` env var — overrides the saved host.
- `reddit login` — interactive Clerk OAuth (PKCE, loopback). Stored under `~/.config/reddit-cli/config.json`.

Defaults pick the right Clerk tenant per host (staging vs `reddit.viewengine.ai`).

## Programmatic use

```ts
import { buildProgram } from "@mirage-cli/reddit-cli";

const program = buildProgram();
await program.parseAsync(["node", "reddit", "hot", "programming", "--json"]);
```

Drop-in for mirage: see `@mirage-cli/reddit`.
