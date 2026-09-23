/**
 * @mirage-cli/markup — the ViewEngine Markup CLI as an importable Commander
 * program plus a ready-made mirage CommandFn.
 *
 *   import { markupCommand, buildProgram } from "@mirage-cli/markup";
 *
 * `@mirage-cli/markup-cli` exports `buildProgram()` with no side effects on
 * import, so this wrapper is a thin convenience layer.
 *
 * ## Env vars
 *
 * - `MARKUP_HOST=...` — the deployment (default https://markup.viewengine.dev).
 * - `MARKUP_TOKEN=...` — an OAuth access token for the account-wide MCP. In a
 *   Worker there is no config file, so a host injects this per call.
 *
 * ## Worker compatibility
 *
 * Every board and annotation command is a `fetch` to `<host>/mcp`. `login`
 * opens a loopback `node:http` server and `logout`/`login` write the config
 * file with `node:fs` — fine on Bun/Node, not in workerd; use `MARKUP_TOKEN`.
 */

import type { Command } from "commander";
import { buildProgram as buildMarkupProgram } from "@mirage-cli/markup-cli";
import {
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
// @struktoai/mirage-core is an optional peer dep — only needed for
// `markupResource()`. Type-only at compile time.
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

/**
 * Build (or return the cached) markup Commander program. Synchronous,
 * idempotent — markup-cli's `buildProgram` is a pure function.
 */
export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildMarkupProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

/**
 * Mirage CommandFn for the Markup CLI.
 *
 *   import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
 *   import { markupCommand } from "@mirage-cli/markup";
 *
 *   export const markup = command({
 *     name: "markup",
 *     resource: null,
 *     spec: new CommandSpec({
 *       rest: new Operand({ kind: OperandKind.TEXT }),
 *       description: "ViewEngine Markup CLI",
 *     }),
 *     fn: markupCommand,
 *   });
 */
export const markupCommand: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

/**
 * Drop-in for a mirage Workspace. Returns a minimal mirage `Resource` whose
 * `commands()` exposes the markup CLI as a general (resource-less) command.
 *
 *   import { markupResource } from "@mirage-cli/markup";
 *   import { Workspace } from "@struktoai/mirage-node";
 *
 *   const ws = new Workspace({ ... });
 *   ws.addMount("/cli/markup", await markupResource());
 *   await ws.execute("markup boards --json");
 */
let cachedResource: Resource | null = null;
export async function markupResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const m = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: m.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new m.RegisteredCommand({
      name: "markup",
      resource: null,
      spec: new m.CommandSpec({
        rest: new m.Operand({ kind: m.OperandKind.TEXT }),
        description: "ViewEngine Markup CLI",
      }),
      fn: fn as unknown as Parameters<typeof m.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "markup",
    isRemote: true,
    prompt:
      "ViewEngine Markup CLI (boards and annotations on live pages). Auth via MARKUP_TOKEN " +
      "or `markup login`. Use `markup --help` to discover subcommands.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
