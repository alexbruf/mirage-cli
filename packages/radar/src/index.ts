/**
 * @mirage-cli/radar — ViewEngine Radar CLI wrapped as an importable Commander
 * program plus a ready-made mirage CommandFn.
 *
 *   import { radarCommand, buildProgram } from "@mirage-cli/radar";
 *
 * Because `@mirage-cli/radar-cli` exports `buildProgram()` directly (no
 * auto-parse side effects on import), this wrapper is just a thin convenience
 * layer.
 *
 * ## Env vars
 *
 * - `RADAR_API_KEY=sk_...` — Clerk machine API key (preferred for headless/CI).
 * - `RADAR_OAUTH_ACCESS_TOKEN=...` — alternative bare bearer token override.
 * - `RADAR_API_BASE_URL=https://radar.viewengine.ai` — base URL override.
 *
 * Interactive Clerk OAuth login is supported via `radar login` (browser /
 * loopback). Persisted to `~/.config/radar/session.json`.
 *
 * ## Worker compatibility
 *
 * API-call subcommands (`jobs`, `analytics`, `models`) are pure `fetch`. The
 * `login` subcommand uses `node:http` (loopback) and `node:child_process`
 * (open browser) and will fail at runtime in workerd. Pre-provision a session
 * (or set `RADAR_API_KEY`) and other subcommands work fine.
 */

import type { Command } from "commander";
import { buildProgram as buildRadarProgram } from "@mirage-cli/radar-cli";
import {
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

/**
 * Build (or return the cached) radar Commander program. Synchronous,
 * idempotent — radar-cli's `buildProgram` is a pure function.
 */
export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildRadarProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

/**
 * Mirage CommandFn for the Radar CLI.
 *
 *   import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
 *   import { radarCommand } from "@mirage-cli/radar";
 *
 *   export const radar = command({
 *     name: "radar",
 *     resource: null,
 *     spec: new CommandSpec({
 *       rest: new Operand({ kind: OperandKind.TEXT }),
 *       description: "ViewEngine Radar CLI",
 *     }),
 *     fn: radarCommand,
 *   });
 */
export const radarCommand: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

let cachedResource: Resource | null = null;
export async function radarResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const m = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: m.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new m.RegisteredCommand({
      name: "radar",
      resource: null,
      spec: new m.CommandSpec({
        rest: new m.Operand({ kind: m.OperandKind.TEXT }),
        description: "ViewEngine Radar CLI",
      }),
      fn: fn as unknown as Parameters<typeof m.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "radar",
    isRemote: true,
    prompt:
      "ViewEngine Radar CLI — batch AI visibility jobs against radar.viewengine.ai. " +
      "Auth via `radar login` (Clerk OAuth) or RADAR_API_KEY env var. " +
      "Use `radar --help` to discover subcommands (jobs, models, analytics).",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
