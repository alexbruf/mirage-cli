# @mirage-cli/hubspot

[`@mirage-cli/hubspot-cli`](../hubspot-cli) (read-only HubSpot CRM / marketing / CMS CLI) as an importable mirage / Cloudflare-Worker command via [`@mirage-cli/core`](../core).

```ts
import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
import { hubspotCommand } from "@mirage-cli/hubspot";

export const hubspot = command({
  name: "hubspot",
  resource: null,
  spec: new CommandSpec({
    rest: new Operand({ kind: OperandKind.TEXT }),
    description: "HubSpot CLI (read-only CRM/marketing/CMS)",
  }),
  fn: hubspotCommand,
});
```

Or grab the whole thing as a mirage resource: `await hubspotResource()`.

## Env vars

| Var | Purpose |
| --- | --- |
| `HUBSPOT_ACCESS_TOKEN` | Private app access token or any OAuth/access token — used directly as a bearer (simplest) |
| `HUBSPOT_PERSONAL_ACCESS_KEY` | Personal access key (the `hs` credential); exchanged for a short-lived token |
| `HUBSPOT_ACCOUNT_ID` | Portal id to pin when exchanging a personal access key |
| `HUBSPOT_API_BASE_URL` | Base URL override (default `https://api.hubapi.com`) |

On a workstation, no env is needed — the CLI reuses the accounts in `~/.hscli/config.yml` (run `hs account auth`); select one with `--account <name|id>`.

## Worker compatibility

All subcommands are pure `fetch`, and the client is GET + read-only `/search` POST only (read-only by construction). `node:fs` is only touched when env credentials are absent and `~/.hscli/config.yml` is read — set `HUBSPOT_ACCESS_TOKEN` and that path never runs, so workerd's `nodejs_compat` stubs are sufficient.
