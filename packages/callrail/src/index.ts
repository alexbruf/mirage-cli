/**
 * @mirage-cli/callrail — CallRail CLI wrapped as an importable Commander
 * program plus a ready-made mirage CommandFn.
 *
 *   import { callrailCommand, buildProgram } from "@mirage-cli/callrail";
 *
 * Because `@mirage-cli/callrail-cli` exports `buildProgram()` directly (no
 * auto-parse side effects on import), this wrapper is just a thin convenience
 * layer.
 *
 * ## Env vars
 *
 * - `CALLRAIL_API_KEY=...` — single API key (simplest for headless/CI).
 * - `CALLRAIL_API_KEYS="name:key,name2:key2"` — multiple keys as named
 *   profiles (or a JSON object `{"name":{"apiKey":"...","accountId":"ACC..."}}`).
 *   Select with `--profile <name>` / `CALLRAIL_PROFILE`.
 * - `CALLRAIL_ACCOUNT_ID=ACC...` — account override (auto-detected when the
 *   key sees exactly one account).
 * - `CALLRAIL_API_BASE_URL=https://api.callrail.com/v3` — base URL override.
 *
 * On a workstation, profiles can instead be persisted to
 * `~/.config/callrail/config.json` via `callrail auth add/use`.
 *
 * ## Worker compatibility
 *
 * All data subcommands are pure `fetch` (the client is GET-only — the CLI is
 * read-only by construction). `node:fs` is only touched when env credentials
 * are absent and the on-disk profile store is consulted, and by the
 * `auth add/use/remove` + `accounts use` persistence commands — set env vars
 * in workerd and never hit it.
 */

import type { Command } from "commander";
import { buildProgram as buildCallrailProgram } from "@mirage-cli/callrail-cli";
import {
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

/**
 * Build (or return the cached) callrail Commander program. Synchronous,
 * idempotent — callrail-cli's `buildProgram` is a pure function.
 */
export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildCallrailProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

/**
 * Mirage CommandFn for the CallRail CLI.
 *
 *   import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
 *   import { callrailCommand } from "@mirage-cli/callrail";
 *
 *   export const callrail = command({
 *     name: "callrail",
 *     resource: null,
 *     spec: new CommandSpec({
 *       rest: new Operand({ kind: OperandKind.TEXT }),
 *       description: "CallRail CLI (read-only call tracking)",
 *     }),
 *     fn: callrailCommand,
 *   });
 */
export const callrailCommand: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

let cachedResource: Resource | null = null;
export async function callrailResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const m = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: m.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new m.RegisteredCommand({
      name: "callrail",
      resource: null,
      spec: new m.CommandSpec({
        rest: new m.Operand({ kind: m.OperandKind.TEXT }),
        description: "CallRail CLI (read-only call tracking)",
      }),
      fn: fn as unknown as Parameters<typeof m.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "callrail",
    isRemote: true,
    prompt:
      "CallRail CLI — read-only call tracking data from api.callrail.com (calls, companies, " +
      "trackers, text conversations, form submissions, call summaries/timeseries). " +
      "Auth via CALLRAIL_API_KEY (single key) or CALLRAIL_API_KEYS=\"name:key,...\" profiles " +
      "selected with --profile; account via CALLRAIL_ACCOUNT_ID or auto-detected. " +
      "Output defaults to JSON (-f jsonl|table|csv available). " +
      "Use `callrail --help` to discover subcommands.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
