# @mirage-cli/ga4-cli

Google Analytics 4 CLI — wraps the GA4 Data API + Admin API. Vendored from [Bin-Huang/google-analytics-cli](https://github.com/Bin-Huang/google-analytics-cli) (Apache-2.0), refactored to expose `buildProgram()` and extended with interactive OAuth.

```
bun add -g @mirage-cli/ga4-cli

# Auth, any of:
ga4 login                         # interactive PKCE-loopback (requires GA4_OAUTH_CLIENT_ID env)
export GA4_OAUTH_ACCESS_TOKEN=...  # raw bearer for CI / scripts
ga4 --credentials key.json ...     # service account JSON
ga4 --profile prod ...             # named SA under ~/.config/google-analytics-cli/profiles/<name>.json

# Reporting
ga4 --property 123456789 report --dimensions sessionSource --metrics sessions
ga4 --property 123456789 realtime --dimensions country --metrics activeUsers
ga4 --property 123456789 metadata

# Admin
ga4 accounts
ga4 --property 123456789 property
ga4 properties 123456789
```

## Auth precedence (highest first)

1. `--credentials <path>` flag (service account JSON file)
2. `--profile <name>` flag (saved SA at `~/.config/google-analytics-cli/profiles/<name>.json`)
3. `GA4_OAUTH_ACCESS_TOKEN` env var (raw bearer; no refresh)
4. Stored OAuth tokens from `ga4 login` (`~/.config/google-analytics-cli/oauth.json`; auto-refreshes)
5. Default SA path: `~/.config/google-analytics-cli/credentials.json`
6. `GOOGLE_APPLICATION_CREDENTIALS` env var, or Application Default Credentials (handled by `google-auth-library`)

## Interactive OAuth — required env vars

`ga4 login` runs a PKCE loopback to `accounts.google.com`. You must register your own OAuth client (Desktop app) at <https://console.cloud.google.com/apis/credentials> and set:

```
GA4_OAUTH_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
GA4_OAUTH_CLIENT_SECRET=<your-client-secret>   # required for Google Desktop apps
```

Optional: `GA4_OAUTH_SCOPES` (default `https://www.googleapis.com/auth/analytics.readonly`), `GA4_OAUTH_PORT` (default `53683`).

Tokens land at `~/.config/google-analytics-cli/oauth.json` (600 perms) and are auto-refreshed.

## Auth commands

```
ga4 login [--client-id ...] [--client-secret ...] [--scopes ...] [--port ...]
ga4 logout
ga4 whoami
```

## Programmatic use

```ts
import { buildProgram } from "@mirage-cli/ga4-cli";

const program = buildProgram();
await program.parseAsync(["node", "ga4", "accounts", "--format", "json"]);
```

Drop-in for mirage: see `@mirage-cli/ga4`.

## Provenance

Vendored from [`Bin-Huang/google-analytics-cli`](https://github.com/Bin-Huang/google-analytics-cli) — Apache-2.0 (see `LICENSE`). OAuth layer and refactor for mirage compatibility added on top.
