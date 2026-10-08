/**
 * @mirage-cli/mobbin — the Mobbin CLI as an importable Commander program plus
 * a ready-made mirage CommandFn.
 *
 *   import { mobbinCommand, buildProgram } from "@mirage-cli/mobbin";
 *
 * `@mirage-cli/mobbin-cli` exports `buildProgram()` with no side effects on
 * import, so this wrapper is a thin convenience layer.
 *
 * ## Env vars
 *
 * - `MOBBIN_ACCESS_TOKEN=...` — an OAuth access token for Mobbin's MCP server.
 *   In a Worker there is no config file, so a host injects this per call.
 * - `MOBBIN_MCP_URL=...` — override the endpoint (default https://api.mobbin.com/mcp).
 *
 * ## Worker compatibility
 *
 * Every search is a `fetch` to the MCP endpoint, and `--save` writes through
 * the Mirage VFS bridge (`globalThis.__MIRAGE_CLI_FILE_IO__`). `login` opens a
 * loopback `node:http` server and `login`/`logout` write the config file with
 * `node:fs`: fine on Bun/Node, not in workerd; use `MOBBIN_ACCESS_TOKEN`.
 */

import type { Command } from "commander";
import { buildProgram as buildMobbinProgram } from "@mirage-cli/mobbin-cli";
import {
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
// @struktoai/mirage-core is an optional peer dep — only needed for
// `mobbinResource()`. Type-only at compile time.
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

/**
 * Build (or return the cached) mobbin Commander program. Synchronous,
 * idempotent — mobbin-cli's `buildProgram` is a pure function.
 */
export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildMobbinProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

/**
 * Mirage CommandFn for the Mobbin CLI.
 *
 *   import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
 *   import { mobbinCommand } from "@mirage-cli/mobbin";
 *
 *   export const mobbin = command({
 *     name: "mobbin",
 *     resource: null,
 *     spec: new CommandSpec({
 *       rest: new Operand({ kind: OperandKind.TEXT }),
 *       description: "Mobbin CLI",
 *     }),
 *     fn: mobbinCommand,
 *   });
 */
export const mobbinCommand: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

/**
 * Drop-in for a mirage Workspace. Returns a minimal mirage `Resource` whose
 * `commands()` exposes the mobbin CLI as a general (resource-less) command.
 *
 *   import { mobbinResource } from "@mirage-cli/mobbin";
 *   import { Workspace } from "@struktoai/mirage-node";
 *
 *   const ws = new Workspace({ ... });
 *   ws.addMount("/cli/mobbin", await mobbinResource());
 *   await ws.execute("mobbin sections pricing with three tiers --json");
 */
let cachedResource: Resource | null = null;
export async function mobbinResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const m = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: m.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new m.RegisteredCommand({
      name: "mobbin",
      resource: null,
      spec: new m.CommandSpec({
        rest: new m.Operand({ kind: m.OperandKind.TEXT }),
        description: "Mobbin CLI",
      }),
      fn: fn as unknown as Parameters<typeof m.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "mobbin",
    isRemote: true,
    prompt:
      "Mobbin CLI (search real app and website UI: screens, flows, website sections). Auth via " +
      "MOBBIN_ACCESS_TOKEN or `mobbin login`. Use `mobbin --help` to discover subcommands.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
