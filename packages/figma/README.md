# @mirage-cli/figma

Thin adapter that surfaces [`@mirage-cli/figma-cli`](../figma-cli) as a mirage command and Resource, for [mirage](https://github.com/strukto-ai/mirage) runtimes and Cloudflare Workers.

```sh
bun add @mirage-cli/figma @mirage-cli/figma-cli
```

## API

```ts
import { buildProgram, figmaCommand, figmaResource } from "@mirage-cli/figma";
```

- `buildProgram(): Command` — the cached Commander program. Synchronous and idempotent.
- `figmaCommand: MirageCommandFn` — ready to plug into `command({ fn: figmaCommand })`.
- `figmaResource(): Promise<Resource>` — a resource-less Resource registering the global `figma` command, with a prompt describing the command surface and its footguns.

## As a mirage command

```ts
import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
import { figmaCommand } from "@mirage-cli/figma";

export const figma = command({
  name: "figma",
  resource: null,
  spec: new CommandSpec({
    rest: new Operand({ kind: OperandKind.TEXT }),
    description: "Figma CLI (files, exports, comments, variables)",
  }),
  fn: figmaCommand,
});
```

## Long-lived hosts: build a fresh program per call

Commander stores parsed option state on the program instance, so the cached `buildProgram()` here leaks flags between invocations in a host that runs many commands in one process. Call `@mirage-cli/figma-cli`'s `buildProgram()` directly instead — that is what ve-brain's `makeCommanderCliResource` does:

```ts
import { buildProgram } from "@mirage-cli/figma-cli";

makeCommanderCliResource({ name: "figma", buildProgram: () => buildProgram(), prompt });
```

## Env vars

| Var | Meaning |
| --- | --- |
| `FIGMA_OAUTH_ACCESS_TOKEN` | OAuth 2 access token, sent as `Authorization: Bearer`. Wins over the personal access token. |
| `FIGMA_TOKEN` | Personal access token, sent as `X-Figma-Token`. Aliases: `FIGMA_API_KEY`, `FIGMA_PERSONAL_ACCESS_TOKEN`. |
| `FIGMA_FILE_KEY` / `FIGMA_TEAM_ID` | Defaults for commands whose file/team argument is omitted. |
| `FIGMA_API_BASE_URL` | Base URL override (`https://api.figma-gov.com` for Figma for Government). |

Because OAuth outranks the personal access token, a host that refreshes OAuth per call can inject `FIGMA_OAUTH_ACCESS_TOKEN` alone and leave the rest unset.

## Worker compatibility

Pure `fetch`. `node:fs` and `node:path` are imported dynamically and only on the local-filesystem fallback of `figma export --save`; inside a mirage workspace that path goes through `globalThis.__MIRAGE_CLI_FILE_IO__` and is never reached. Runs unchanged under workerd.

See [`@mirage-cli/figma-cli`](../figma-cli) for the full command surface, rate-limit behaviour, and the `--depth` / `--save` notes.
