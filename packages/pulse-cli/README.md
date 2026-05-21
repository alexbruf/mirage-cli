# @mirage-cli/pulse-cli

ViewEngine Pulse CLI — batch AI visibility jobs against `pulse.viewengine.ai`.

```
bun add -g @mirage-cli/pulse-cli
pulse login                    # Clerk OAuth (browser)
pulse login --api-key sk_...   # headless / CI
pulse jobs list
pulse jobs create --file in.csv --name "Q1 audit" --prompt-column query --models chatgpt_api,perplexity
pulse jobs download <id> -o results.csv
```

## Auth

- `pulse login` — Clerk OAuth (PKCE + RFC 7591 DCR + loopback). Persists to `~/.config/pulse/session.json` (0600).
- `pulse login --api-key sk_...` — Clerk machine API key for headless use.
- Env override: `PULSE_API_KEY` (preferred) or `PULSE_OAUTH_ACCESS_TOKEN`. `PULSE_API_BASE_URL` overrides the base URL.

## Programmatic use

```ts
import { buildProgram, ApiClient, loadSession } from "@mirage-cli/pulse-cli";

// As a Commander program (drives the same CLI surface):
const program = buildProgram();
await program.parseAsync(["node", "pulse", "jobs", "list", "--format", "json"]);

// As a typed API client:
const session = loadSession();
if (session) {
  const client = new ApiClient(session);
  const { jobs } = await client.request<{ jobs: unknown[] }>("/jobs");
}
```

Drop-in for mirage: see `@mirage-cli/pulse`.
