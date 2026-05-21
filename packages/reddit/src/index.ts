/**
 * @mirage-cli/reddit — Reddit CLI wrapped as an importable Commander program
 * plus a ready-made mirage CommandFn.
 *
 *   import { redditCommand, buildProgram } from "@mirage-cli/reddit";
 *
 * Because `@mirage-cli/reddit-cli` exports `buildProgram()` directly (no
 * auto-parse side effects on import), this wrapper is just a thin convenience
 * layer.
 *
 * ## Env vars
 *
 * - `REDDIT_API_HOST=...` — the reddit-api host (e.g. https://reddit.viewengine.ai).
 * - `REDDIT_API_KEY=...` — bearer token for the reddit-api service.
 *
 * ## Worker compatibility
 *
 * The CLI is `fetch`-based with no `node:fs` / `child_process` in the hot path
 * for API calls. `login` / `logout` / `config` subcommands touch `node:fs`
 * and `node:http` (OAuth loopback) — fine on Bun/Node, will fail at runtime
 * in workerd. `config show`, listings (`hot`, `new`, `search`, etc.) work.
 */

import type { Command } from "commander";
import { buildProgram as buildRedditProgram } from "@mirage-cli/reddit-cli";
import {
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
// @struktoai/mirage-core is an optional peer dep — only needed for
// `redditResource()`. Type-only at compile time.
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

/**
 * Build (or return the cached) reddit Commander program. Synchronous,
 * idempotent — reddit-cli's `buildProgram` is a pure function.
 */
export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildRedditProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

/**
 * Mirage CommandFn for the Reddit CLI.
 *
 *   import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
 *   import { redditCommand } from "@mirage-cli/reddit";
 *
 *   export const reddit = command({
 *     name: "reddit",
 *     resource: null,
 *     spec: new CommandSpec({
 *       rest: new Operand({ kind: OperandKind.TEXT }),
 *       description: "Reddit CLI",
 *     }),
 *     fn: redditCommand,
 *   });
 */
export const redditCommand: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

/**
 * Drop-in for a mirage Workspace. Returns a minimal mirage `Resource` whose
 * `commands()` exposes the reddit CLI as a general (resource-less) command.
 *
 *   import { redditResource } from "@mirage-cli/reddit";
 *   import { Workspace } from "@struktoai/mirage-node";
 *
 *   const ws = new Workspace({ ... });
 *   ws.addMount("/cli/reddit", await redditResource());
 *   await ws.execute("reddit hot programming -l 10 --json");
 */
let cachedResource: Resource | null = null;
export async function redditResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const m = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: m.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new m.RegisteredCommand({
      name: "reddit",
      resource: null,
      spec: new m.CommandSpec({
        rest: new m.Operand({ kind: m.OperandKind.TEXT }),
        description: "Reddit CLI",
      }),
      fn: fn as unknown as Parameters<typeof m.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "reddit",
    isRemote: true,
    prompt:
      "Reddit CLI (drives reddit.viewengine.ai). Auth via `reddit login` (Clerk OAuth) " +
      "or REDDIT_API_KEY env var. Use `reddit --help` to discover subcommands.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
