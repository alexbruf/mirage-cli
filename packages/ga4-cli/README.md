# @mirage-cli/ga4-cli

Google Analytics 4 CLI — Data + Admin API surface, fetch-only under the hood. Runs in Node, Bun, and Cloudflare Workers.

```
bun add -g @mirage-cli/ga4-cli

# Auth, any of:
ga4 login                          # interactive PKCE-loopback (requires GA4_OAUTH_CLIENT_ID env)
export GA4_OAUTH_ACCESS_TOKEN=...   # raw bearer for CI / Workers
ga4 --credentials key.json ...      # service account JSON (signed via Web Crypto)
ga4 --profile prod ...              # named SA under ~/.config/google-analytics-cli/profiles/<name>.json

# Reporting
ga4 --property 123456789 report --dimensions sessionSource --metrics sessions --date-ranges '[{"startDate":"7daysAgo","endDate":"yesterday"}]'
ga4 --property 123456789 pivot-report --dimensions country --metrics sessions --date-ranges '[{"startDate":"7daysAgo","endDate":"yesterday"}]' --pivots '[{"fieldNames":["country"],"limit":5}]'
ga4 --property 123456789 batch-report --requests '[{...},{...}]'
ga4 --property 123456789 realtime --dimensions country --metrics activeUsers
ga4 --property 123456789 metadata
ga4 --property 123456789 check-compatibility --dimensions country --metrics sessions

# Admin
ga4 accounts
ga4 --property 123456789 property
ga4 properties 123456789
ga4 --property 123456789 data-streams
ga4 --property 123456789 key-events
ga4 --property 123456789 admin-custom-dimensions
ga4 --property 123456789 admin-custom-metrics
ga4 --property 123456789 data-retention
ga4 --property 123456789 ads-links
ga4 --property 123456789 annotations
ga4 change-history 116856948

# Audience exports
ga4 --property 123456789 audience-exports
ga4 --property 123456789 audience-export-create --audience properties/123456789/audiences/4567
ga4 --property 123456789 audience-export-query <exportId>
```

## Auth precedence (highest first)

1. `--credentials <path>` flag (service account JSON file; signed with Web Crypto)
2. `--profile <name>` flag (saved SA at `~/.config/google-analytics-cli/profiles/<name>.json`)
3. `GA4_OAUTH_ACCESS_TOKEN` env var (raw bearer; no refresh)
4. Stored OAuth tokens from `ga4 login` (`~/.config/google-analytics-cli/oauth.json`; auto-refreshes)
5. Default SA path: `~/.config/google-analytics-cli/credentials.json`
6. `GOOGLE_APPLICATION_CREDENTIALS` env var (service-account JSON path)

## Workerd compatibility

**Yes, this runs in Cloudflare Workers.** The hot path is pure `fetch`. Service-account JWT signing uses `crypto.subtle` (Web Crypto), available universally. The package has zero Google client libraries — no `@google-analytics/{data,admin}`, no `googleapis`, no `google-auth-library`, no `@grpc/grpc-js`, no `protobuf.js`. Only runtime dep is `commander`.

```ts
// In a Worker:
import { buildProgram, signServiceAccountJWT, gaRequest, authHeaders, DATA_BETA } from "@mirage-cli/ga4-cli";
import { runCommander } from "@mirage-cli/core";

export default {
  async fetch(req: Request, env: { GA4_OAUTH_ACCESS_TOKEN: string }) {
    process.env.GA4_OAUTH_ACCESS_TOKEN = env.GA4_OAUTH_ACCESS_TOKEN;
    const r = await runCommander(buildProgram(), ["--property", "123", "accounts"]);
    return new Response(r.stdout as BodyInit);
  },
};
```

Or call the REST primitives directly:

```ts
import { signServiceAccountJWT, gaRequest, DATA_BETA } from "@mirage-cli/ga4-cli";
const token = await signServiceAccountJWT(JSON.parse(env.GA4_SA_JSON));
const data = await gaRequest(`${DATA_BETA}/properties/123:runReport`, { method: "POST", body: { ... } });
```

The `login` / interactive subcommands touch `node:fs` and `node:http` for the loopback OAuth flow — those won't run in workerd, but they're not needed there anyway (use a service account or `GA4_OAUTH_ACCESS_TOKEN`).

## Interactive OAuth — required env vars

`ga4 login` runs a PKCE loopback to `accounts.google.com`. Register your own OAuth client (Desktop app) at <https://console.cloud.google.com/apis/credentials> and set:

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

Forked from [`Bin-Huang/google-analytics-cli`](https://github.com/Bin-Huang/google-analytics-cli) (Apache-2.0). CLI surface (commands, args, output format) preserved 1:1; only the underlying transport changed. The original used `@google-analytics/{data,admin}` (gRPC + protobuf.js), which can't run in Cloudflare Workers due to V8's runtime-codegen restriction. We replaced it with direct REST calls to `analyticsdata.googleapis.com/v1beta` and `analyticsadmin.googleapis.com/v1beta`, plus Web Crypto for service-account JWT signing.
