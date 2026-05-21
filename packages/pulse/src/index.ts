/**
 * @mirage-cli/pulse — ViewEngine Pulse CLI wrapped as an importable Commander
 * program plus a ready-made mirage CommandFn.
 *
 *   import { pulseCommand, buildProgram } from "@mirage-cli/pulse";
 *
 * Because `@mirage-cli/pulse-cli` exports `buildProgram()` directly (no
 * auto-parse side effects on import), this wrapper is just a thin convenience
 * layer.
 *
 * ## Env vars
 *
 * - `PULSE_API_KEY=sk_...` — Clerk machine API key (preferred for headless/CI).
 * - `PULSE_OAUTH_ACCESS_TOKEN=...` — alternative bare bearer token override.
 * - `PULSE_API_BASE_URL=https://pulse.viewengine.ai` — base URL override.
 *
 * Interactive Clerk OAuth login is supported via `pulse login` (browser /
 * loopback). Persisted to `~/.config/pulse/session.json`.
 *
 * ## Worker compatibility
 *
 * API-call subcommands (`jobs`, `analytics`, `models`) are pure `fetch`. The
 * `login` subcommand uses `node:http` (loopback) and `node:child_process`
 * (open browser) and will fail at runtime in workerd. Pre-provision a session
 * (or set `PULSE_API_KEY`) and other subcommands work fine.
 */

import type { Command } from "commander";
import { buildProgram as buildPulseProgram } from "@mirage-cli/pulse-cli";
import {
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

/**
 * Build (or return the cached) pulse Commander program. Synchronous,
 * idempotent — pulse-cli's `buildProgram` is a pure function.
 */
export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildPulseProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

/**
 * Mirage CommandFn for the Pulse CLI.
 *
 *   import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
 *   import { pulseCommand } from "@mirage-cli/pulse";
 *
 *   export const pulse = command({
 *     name: "pulse",
 *     resource: null,
 *     spec: new CommandSpec({
 *       rest: new Operand({ kind: OperandKind.TEXT }),
 *       description: "ViewEngine Pulse CLI",
 *     }),
 *     fn: pulseCommand,
 *   });
 */
export const pulseCommand: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

let cachedResource: Resource | null = null;
export async function pulseResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const m = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: m.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new m.RegisteredCommand({
      name: "pulse",
      resource: null,
      spec: new m.CommandSpec({
        rest: new m.Operand({ kind: m.OperandKind.TEXT }),
        description: "ViewEngine Pulse CLI",
      }),
      fn: fn as unknown as Parameters<typeof m.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "pulse",
    isRemote: true,
    prompt:
      "ViewEngine Pulse CLI — batch AI visibility jobs against pulse.viewengine.ai. " +
      "Auth via `pulse login` (Clerk OAuth) or PULSE_API_KEY env var. " +
      "Use `pulse --help` to discover subcommands (jobs, models, analytics).",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
