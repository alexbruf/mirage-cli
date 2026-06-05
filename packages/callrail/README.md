# @mirage-cli/callrail

[`@mirage-cli/callrail-cli`](../callrail-cli) (read-only CallRail call-tracking CLI) as an importable mirage / Cloudflare-Worker command via [`@mirage-cli/core`](../core).

```ts
import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
import { callrailCommand } from "@mirage-cli/callrail";

export const callrail = command({
  name: "callrail",
  resource: null,
  spec: new CommandSpec({
    rest: new Operand({ kind: OperandKind.TEXT }),
    description: "CallRail CLI (read-only call tracking)",
  }),
  fn: callrailCommand,
});
```

Or grab the whole thing as a mirage resource: `await callrailResource()`.

## Env vars

| Var | Purpose |
| --- | --- |
| `CALLRAIL_API_KEY` | Single API key (simplest) |
| `CALLRAIL_API_KEYS` | Multiple keys as profiles: `"name:key,name2:key2"` or JSON `{"name":{"apiKey":"...","accountId":"ACC..."}}` |
| `CALLRAIL_PROFILE` | Default profile selector (per-call: `--profile`) |
| `CALLRAIL_ACCOUNT_ID` | Account override (auto-detected when the key sees one) |
| `CALLRAIL_API_BASE_URL` | Base URL override (default `https://api.callrail.com/v3`) |

## Worker compatibility

All data subcommands are pure `fetch`, and the client is GET-only (read-only by construction). `node:fs` is only touched for the on-disk profile store — with env credentials set, it's never called, so workerd's `nodejs_compat` stubs are sufficient.
