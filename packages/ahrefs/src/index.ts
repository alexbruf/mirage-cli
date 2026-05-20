/**
 * @mirage-cli/ahrefs — Ahrefs CLI wrapped as an importable Commander program
 * plus a ready-made mirage CommandFn.
 *
 *   import { ahrefsCommand, buildProgram } from "@mirage-cli/ahrefs";
 *
 * Because `ahrefs-cli` exports `buildProgram()` directly (no auto-parse side
 * effects on import), this wrapper is just a thin convenience layer.
 *
 * ## Env vars
 *
 * `AHREFS_API_KEY=...` — required for all API-call commands.
 *
 * ## Worker compatibility
 *
 * `ahrefs-cli` is pure-fetch (`fetch` → Ahrefs API v3 over HTTPS). No
 * `node:fs` / `child_process` in the hot path. Works in workerd under
 * `nodejs_compat`.
 */

import type { Command } from "commander";
import { buildProgram as buildAhrefsProgram } from "@mirage-cli/ahrefs-cli";
import { toMirageCommandFn, type IOResultCtor, type MirageCommandFn } from "@mirage-cli/core";
// @struktoai/mirage-core is an optional peer dep — only needed for
// `ahrefsResource()`. Type-only at compile time.
import type {
  RegisteredCommand,
  Resource,
} from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

/**
 * Build (or return the cached) ahrefs Commander program. Synchronous,
 * idempotent — ahrefs-cli's `buildProgram` is a pure function with no
 * side effects.
 */
export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildAhrefsProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

/**
 * Mirage CommandFn for the Ahrefs CLI.
 *
 *   import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
 *   import { ahrefsCommand } from "@mirage-cli/ahrefs";
 *
 *   export const ahrefs = command({
 *     name: "ahrefs",
 *     resource: null,
 *     spec: new CommandSpec({
 *       rest: new Operand({ kind: OperandKind.TEXT }),
 *       description: "Ahrefs CLI",
 *     }),
 *     fn: ahrefsCommand,
 *   });
 */
export const ahrefsCommand: MirageCommandFn = async (
  accessor,
  paths,
  texts,
  opts,
) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

/**
 * Drop-in for a mirage Workspace. Returns a minimal mirage `Resource` whose
 * `commands()` exposes the ahrefs CLI as a general (resource-less) command.
 *
 *   import { ahrefsResource } from "@mirage-cli/ahrefs";
 *   import { Workspace } from "@struktoai/mirage-node";
 *
 *   const ws = new Workspace({ ... });
 *   ws.addMount("/cli/ahrefs", await ahrefsResource());
 *   await ws.execute("ahrefs --version");
 *
 * `@struktoai/mirage-core` is an optional peer dep — dynamic-imported on
 * first call. Consumers who only use `buildProgram` / `ahrefsCommand` can
 * skip the install.
 */
let cachedResource: Resource | null = null;
export async function ahrefsResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const m = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: m.IOResult as unknown as IOResultCtor,
  });
  // Bypass `m.command()` to preserve commander's `--help` output (see the
  // analogous comment in @mirage-cli/dataforseo).
  const commands: readonly RegisteredCommand[] = [
    new m.RegisteredCommand({
      name: "ahrefs",
      resource: null,
      spec: new m.CommandSpec({
        rest: new m.Operand({ kind: m.OperandKind.TEXT }),
        description: "Ahrefs CLI",
      }),
      fn: fn as unknown as Parameters<typeof m.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "ahrefs",
    isRemote: true,
    prompt:
      "Ahrefs API v3 CLI. Auth via AHREFS_API_KEY env var. Use `ahrefs --help` to discover subcommands.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
