/**
 * @mirage-cli/ve-fanout — the VE Fanout CLI (AI query fan-out) wrapped as an
 * importable Commander program plus a ready-made mirage CommandFn.
 *
 *   import { veFanoutCommand, buildProgram } from "@mirage-cli/ve-fanout";
 *
 * Because `@mirage-cli/ve-fanout-cli` exports `buildProgram()` directly (no
 * auto-parse side effects on import), this wrapper is just a thin convenience
 * layer.
 *
 * ## Env vars
 *
 * - `VE_FANOUT_TOKEN=...` — bearer access token (recommended for runtimes).
 * - `VE_FANOUT_ORG_ID=...` — pin an organization (else the active org from a
 *   prior `ve-fanout login`, or `--org`).
 * - `VE_FANOUT_API_URL=...` — API base URL override (default
 *   `https://fanout.api.viewengine.ai`).
 *
 * ## Read/write boundary
 *
 * Most commands read existing data. Exceptions (these CLIs get wrapped for LLM
 * drivers, so flag them): `queries create`, `queries regenerate`, and
 * `queries run-engine` submit fan-out work that CONSUMES org credits
 * (billable); `queries delete` is destructive. Gate those behind write access
 * in read-only deployments.
 *
 * ## Worker compatibility
 *
 * Token-based read calls are pure `fetch` and run under workerd. The
 * `login`/`logout`/`orgs use|clear` paths touch `node:fs`/`node:http` and open
 * a browser — they throw under workerd, so use `VE_FANOUT_TOKEN` there.
 */

import type { Command } from "commander";
import { buildProgram as buildVeFanoutProgram } from "@mirage-cli/ve-fanout-cli";
import {
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

/**
 * Build (or return the cached) ve-fanout Commander program. Synchronous,
 * idempotent — ve-fanout-cli's `buildProgram` is a pure function.
 */
export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildVeFanoutProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

/**
 * Mirage CommandFn for the VE Fanout CLI.
 *
 *   import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
 *   import { veFanoutCommand } from "@mirage-cli/ve-fanout";
 *
 *   export const veFanout = command({
 *     name: "ve-fanout",
 *     resource: null,
 *     spec: new CommandSpec({
 *       rest: new Operand({ kind: OperandKind.TEXT }),
 *       description: "VE Fanout CLI (AI query fan-out)",
 *     }),
 *     fn: veFanoutCommand,
 *   });
 */
export const veFanoutCommand: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

let cachedResource: Resource | null = null;
export async function veFanoutResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const m = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: m.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new m.RegisteredCommand({
      name: "ve-fanout",
      resource: null,
      spec: new m.CommandSpec({
        rest: new m.Operand({ kind: m.OperandKind.TEXT }),
        description: "VE Fanout CLI (AI query fan-out)",
      }),
      fn: fn as unknown as Parameters<typeof m.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "ve-fanout",
    isRemote: true,
    prompt:
      "VE Fanout CLI — query fan-out for AI visibility. Submit a query and see the sub-queries " +
      "ChatGPT, Gemini (AI Overviews/AI Mode), and Perplexity would generate. Auth via VE_FANOUT_TOKEN " +
      "(optionally VE_FANOUT_ORG_ID / VE_FANOUT_API_URL). Read commands: `queries list|get|watch`, " +
      "`engines list`, `credits` (balance/transactions), `status` (public), `orgs list|current`, `whoami`. " +
      "`queries create` submits a fan-out and `queries regenerate` / `queries run-engine` re-run engines — " +
      "all THREE are BILLABLE (consume org credits). `queries delete` is destructive. `login`/`logout`/`orgs use` " +
      "are interactive/Node-only (skip in workers). `queries create` returns a sessionId; results are async — " +
      "use `queries watch <sessionId>`. Output is JSON. Use `ve-fanout --help` to discover subcommands.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
