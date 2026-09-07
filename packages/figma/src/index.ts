/**
 * @mirage-cli/figma — the Figma CLI wrapped as an importable Commander program
 * plus a ready-made mirage CommandFn.
 *
 *   import { figmaCommand, buildProgram } from "@mirage-cli/figma";
 *
 * Because `@mirage-cli/figma-cli` exports `buildProgram()` directly (no
 * auto-parse side effects on import), this wrapper is just a thin convenience
 * layer.
 *
 * ## Env vars
 *
 * - `FIGMA_TOKEN=figd_...` — a personal access token, sent as `X-Figma-Token`.
 *   `FIGMA_API_KEY` and `FIGMA_PERSONAL_ACCESS_TOKEN` are accepted as aliases.
 *   Figma expires these within 90 days and they cannot be renewed in place.
 * - `FIGMA_OAUTH_ACCESS_TOKEN=...` — an OAuth 2 access token, sent as
 *   `Authorization: Bearer`. Takes precedence over the personal access token,
 *   so a host that refreshes OAuth per call can inject only this one.
 * - `FIGMA_FILE_KEY=...` / `FIGMA_TEAM_ID=...` — defaults for commands whose
 *   file/team argument is omitted.
 * - `FIGMA_API_BASE_URL=https://api.figma.com` — base URL override (set it to
 *   `https://api.figma-gov.com` for Figma for Government).
 *
 * ## Worker compatibility
 *
 * Pure `fetch`. `node:fs` and `node:path` are imported dynamically and only on
 * the local-filesystem fallback path of `figma export --save`; inside a mirage
 * workspace that path goes through `globalThis.__MIRAGE_CLI_FILE_IO__` instead
 * and is never reached. Runs unchanged under workerd.
 */

import type { Command } from "commander";
import { buildProgram as buildFigmaProgram } from "@mirage-cli/figma-cli";
import { toMirageCommandFn, type IOResultCtor, type MirageCommandFn } from "@mirage-cli/core";
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

/**
 * Build (or return the cached) figma Commander program. Synchronous,
 * idempotent — figma-cli's `buildProgram` is a pure function.
 *
 * Note for hosts that run many commands in one process: Commander stores
 * parsed option state on the program instance, so a long-lived cache leaks
 * flags between invocations. Call `buildFigmaProgram()` directly (as ve-brain's
 * `makeCommanderCliResource` does) when you need a fresh program per call.
 */
export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildFigmaProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

/**
 * Mirage CommandFn for the Figma CLI.
 *
 *   import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
 *   import { figmaCommand } from "@mirage-cli/figma";
 *
 *   export const figma = command({
 *     name: "figma",
 *     resource: null,
 *     spec: new CommandSpec({
 *       rest: new Operand({ kind: OperandKind.TEXT }),
 *       description: "Figma CLI (files, exports, comments, variables)",
 *     }),
 *     fn: figmaCommand,
 *   });
 */
export const figmaCommand: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

const PROMPT =
  "Figma CLI — read and annotate Figma files over the REST API (api.figma.com). Reads: " +
  "whoami, teams projects, projects files|meta, folders list|children|files|meta, " +
  "files get|nodes|meta|versions, export, image-fills, components|component-sets|styles " +
  "file|team|get, comments list|reactions, variables local|published, dev-resources list. " +
  "Writes (comments post|delete|react|unreact, variables post, dev-resources " +
  "create|update|delete) mutate the live design file. `files get` defaults to --depth 2 " +
  "because a whole Figma file is routinely tens of megabytes; pass --depth 0 only when you " +
  "genuinely need the full tree. `export` returns short-lived render URLs unless you pass " +
  "--save <dir>, which downloads them. File keys accept a raw key or a pasted figma.com URL, " +
  "and node ids accept both the 1:23 and 1-23 spellings. Rate limits are low and tiered — " +
  "file, node, and render calls are 10-20 per minute — so batch --ids into one call instead " +
  "of looping. The variables commands need an Enterprise plan. Auth is handled by the mount. " +
  "Use `figma --help` to discover subcommands.";

let cachedResource: Resource | null = null;
export async function figmaResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const m = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: m.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new m.RegisteredCommand({
      name: "figma",
      resource: null,
      spec: new m.CommandSpec({
        rest: new m.Operand({ kind: m.OperandKind.TEXT }),
        description: "Figma CLI (files, exports, comments, variables, dev resources)",
      }),
      fn: fn as unknown as Parameters<typeof m.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "figma",
    isRemote: true,
    prompt: PROMPT,
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
