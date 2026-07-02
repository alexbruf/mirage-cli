/**
 * @mirage-cli/presscart — Presscart CLI wrapped as an importable Commander
 * program plus a ready-made mirage CommandFn.
 *
 *   import { presscartCommand, buildProgram } from "@mirage-cli/presscart";
 *
 * Because `@mirage-cli/presscart-cli` exports `buildProgram()` directly (no
 * auto-parse side effects on import), this wrapper is just a thin convenience
 * layer.
 *
 * ## Env vars
 *
 * - `PRESSCART_API_TOKEN=pc_...` — required bearer token (per docs).
 * - `PRESSCART_API_BASE_URL=https://api.presscart.com` — base URL override.
 *
 * ## Worker compatibility
 *
 * The Presscart CLI is `fetch`-only on the hot path (REST against
 * `api.presscart.com`). `login` writes to `~/.config/presscart/session.json`
 * via `node:fs` — pre-provision a session file or set `PRESSCART_API_TOKEN`
 * in the env to keep workers happy.
 */

import type { Command } from "commander";
import { buildProgram as buildPresscartProgram } from "@mirage-cli/presscart-cli";
import {
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

/**
 * Build (or return the cached) presscart Commander program. Synchronous,
 * idempotent — presscart-cli's `buildProgram` is a pure function.
 */
export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildPresscartProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

/**
 * Mirage CommandFn for the Presscart CLI.
 *
 *   import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
 *   import { presscartCommand } from "@mirage-cli/presscart";
 *
 *   export const presscart = command({
 *     name: "presscart",
 *     resource: null,
 *     spec: new CommandSpec({
 *       rest: new Operand({ kind: OperandKind.TEXT }),
 *       description: "Presscart CLI",
 *     }),
 *     fn: presscartCommand,
 *   });
 */
export const presscartCommand: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

let cachedResource: Resource | null = null;
export async function presscartResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const m = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: m.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new m.RegisteredCommand({
      name: "presscart",
      resource: null,
      spec: new m.CommandSpec({
        rest: new m.Operand({ kind: m.OperandKind.TEXT }),
        description: "Presscart CLI",
      }),
      fn: fn as unknown as Parameters<typeof m.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "presscart",
    isRemote: true,
    prompt:
      "Presscart CLI — drives api.presscart.com. Auth via PRESSCART_API_TOKEN env var " +
      "(`pc_...`) or `presscart login --token pc_...`. Use `presscart --help` for " +
      "subcommands: teams, campaigns, orders, outlets, profiles, products, articles, files, attachments.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
