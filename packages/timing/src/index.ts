/**
 * @mirage-cli/timing — Timing app CLI wrapped as an importable Commander
 * program plus a ready-made mirage CommandFn.
 *
 *   import { timingCommand, buildProgram } from "@mirage-cli/timing";
 *
 * ## Env vars
 *
 * - `TIMING_API_TOKEN=...` — Timing API personal access token.
 * - `TIMING_API_BASE` (optional) — override the API base URL.
 *
 * ## Worker compatibility
 *
 * All API calls are fetch-only — workerd-safe. Only `timing setup` writes to
 * `~/.config/timing-cli/config.json` (Node/Bun only).
 *
 * ## Read/write boundary
 *
 * **Read:** `projects list/get`, `entries list/get`, `report`, `teams …`,
 * `activities …`.
 * **Write:** `start`, `stop`, `entries create/update/delete`,
 * `projects create/update/delete`. These mutate the user's Timing account.
 * Consumers that expose this command to an LLM should sandbox writes.
 */
import type { Command } from "commander";
import { buildProgram as buildTimingProgram } from "@mirage-cli/timing-cli";
import {
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildTimingProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

export const timingCommand: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

let cachedResource: Resource | null = null;
export async function timingResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const m = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: m.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new m.RegisteredCommand({
      name: "timing",
      resource: null,
      spec: new m.CommandSpec({
        rest: new m.Operand({ kind: m.OperandKind.TEXT }),
        description: "Timing app CLI",
      }),
      fn: fn as unknown as Parameters<typeof m.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "timing",
    isRemote: true,
    prompt:
      "Timing app CLI (web.timingapp.com API). Auth via TIMING_API_TOKEN env var. " +
      "Read: projects/entries/report/teams/activities. " +
      "Write: start/stop, entries create/update/delete, projects create/update/delete. " +
      "Use `timing --help` to discover subcommands.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
