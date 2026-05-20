/**
 * @mirage-cli/dataforseo — DataForSEO CLI wrapped as an importable Commander
 * program plus a ready-made mirage CommandFn.
 *
 *   import { dataforseoCommand, buildProgram } from "@mirage-cli/dataforseo";
 *
 * Because `dataforseo-cli` exports `buildProgram()` directly (no auto-parse
 * side effects on import), this wrapper is just a thin convenience layer:
 * cache the built program, expose a `MirageCommandFn` bound to it.
 *
 * ## Env vars
 *
 * `dataforseo-cli` reads credentials from env (or `~/.config/dataforseo/config.json`
 * which is unavailable in workers):
 *
 *   DATAFORSEO_USERNAME=...
 *   DATAFORSEO_PASSWORD=...
 *
 * Set these in the host environment before calling commands that hit the API.
 *
 * ## Worker compatibility
 *
 * `dataforseo-cli` is pure-fetch; no `node:fs` / `child_process` calls in the
 * hot path. Works in workerd under `nodejs_compat`. The `dfs login` command
 * writes to `~/.config/dataforseo/config.json` and will fail in workers — use
 * env vars instead.
 */

import type { Command } from "commander";
import { buildProgram as buildDfsProgram } from "@mirage-cli/dataforseo-cli";
import { toMirageCommandFn, type IOResultCtor, type MirageCommandFn } from "@mirage-cli/core";
// Type-only imports so @struktoai/mirage-core stays an optional peer dep.
// Consumers who want `dataforseoResource()` (the drop-in for ws.addMount)
// install @struktoai/mirage-core themselves. Consumers who only want
// `buildProgram` / `dataforseoCommand` don't need it.
import type {
  RegisteredCommand,
  Resource,
} from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

/**
 * Build (or return the cached) dfs Commander program. Synchronous —
 * dataforseo-cli's `buildProgram` is a pure function with no side effects.
 */
export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildDfsProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

/**
 * Mirage CommandFn for the DataForSEO CLI.
 *
 *   import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
 *   import { dataforseoCommand } from "@mirage-cli/dataforseo";
 *
 *   export const dfs = command({
 *     name: "dfs",
 *     resource: null,
 *     spec: new CommandSpec({
 *       rest: new Operand({ kind: OperandKind.TEXT }),
 *       description: "DataForSEO CLI",
 *     }),
 *     fn: dataforseoCommand,
 *   });
 */
export const dataforseoCommand: MirageCommandFn = async (
  accessor,
  paths,
  texts,
  opts,
) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

/**
 * The recommended drop-in for a mirage Workspace. Returns a minimal mirage
 * `Resource` whose `commands()` exposes the dfs CLI as a general
 * (resource-less) command — usable globally regardless of mount prefix.
 *
 *   import { dataforseoResource } from "@mirage-cli/dataforseo";
 *   import { Workspace } from "@struktoai/mirage-node";
 *
 *   const ws = new Workspace({ ... });
 *   ws.addMount("/cli/dataforseo", await dataforseoResource());
 *   await ws.execute("dfs --version");
 *
 * `@struktoai/mirage-core` is an optional peer dep; `dataforseoResource()`
 * dynamic-imports it on first call. Consumers who only use `buildProgram`
 * or `dataforseoCommand` (e.g. raw worker invocations) can skip the install.
 *
 * The function is `async` because we lazy-import mirage-core — keeps the
 * peer dep truly optional. Subsequent calls return the cached resource.
 */
let cachedResource: Resource | null = null;
export async function dataforseoResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const m = await import("@struktoai/mirage-core");
  // Build a MirageCommandFn that returns a real mirage IOResult instance —
  // mirage's executor calls `.syncExitCode()` etc. on it.
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: m.IOResult as unknown as IOResultCtor,
  });
  // Bypass `m.command()` because its `withHelpSupport` wraps the fn to
  // short-circuit any `--help` in argv with a spec-based renderer, hiding
  // commander's real help. Constructing RegisteredCommand directly leaves
  // `--help` in `texts` so commander handles it as normal.
  const commands: readonly RegisteredCommand[] = [
    new m.RegisteredCommand({
      name: "dfs",
      resource: null, // null → general/global command
      spec: new m.CommandSpec({
        rest: new m.Operand({ kind: m.OperandKind.TEXT }),
        description: "DataForSEO CLI",
      }),
      fn: fn as unknown as Parameters<typeof m.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "dataforseo",
    isRemote: true,
    prompt:
      "DataForSEO API CLI. Auth via DATAFORSEO_USERNAME / DATAFORSEO_PASSWORD env vars. Use `dfs --help` to discover subcommands.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
