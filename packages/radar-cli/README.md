# @mirage-cli/radar-cli

ViewEngine Radar CLI — batch AI visibility jobs against `radar.viewengine.ai`.

```
bun add -g @mirage-cli/radar-cli
radar login                    # Clerk OAuth (browser)
radar login --api-key sk_...   # headless / CI
radar jobs list
radar jobs create --file in.csv --name "Q1 audit" --prompt-column query --models chatgpt_api,perplexity
radar jobs download <id> -o results.csv
```

## Auth

- `radar login` — Clerk OAuth (PKCE + RFC 7591 DCR + loopback). Persists to `~/.config/radar/session.json` (0600).
- `radar login --api-key sk_...` — Clerk machine API key for headless use.
- Env override: `RADAR_API_KEY` (preferred) or `RADAR_OAUTH_ACCESS_TOKEN`. `RADAR_API_BASE_URL` overrides the base URL.

## Programmatic use

```ts
import { buildProgram, ApiClient, loadSession } from "@mirage-cli/radar-cli";

// As a Commander program (drives the same CLI surface):
const program = buildProgram();
await program.parseAsync(["node", "radar", "jobs", "list", "--format", "json"]);

// As a typed API client:
const session = loadSession();
if (session) {
  const client = new ApiClient(session);
  const { jobs } = await client.request<{ jobs: unknown[] }>("/jobs");
}
```

Drop-in for mirage: see `@mirage-cli/radar`.
