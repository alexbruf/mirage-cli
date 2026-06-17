/**
 * @mirage-cli/localfalcon — Local Falcon CLI wrapped as an importable
 * Commander program plus a ready-made mirage CommandFn.
 *
 *   import { localfalconCommand, buildProgram } from "@mirage-cli/localfalcon";
 *
 * ## Env vars
 *
 * - `LOCALFALCON_API_KEY=...` — Local Falcon API key (the only credential).
 *   Find it in Local Falcon under Settings > API.
 *
 * ## Worker compatibility
 *
 * Every subcommand is fetch-only (Local Falcon REST) — no `node:fs`,
 * `node:http`, or interactive auth on any path — so the whole program runs in
 * workerd.
 *
 * ## Read/write boundary
 *
 * All commands read existing data EXCEPT `scan`, which runs a new grid scan and
 * consumes Local Falcon scan credits (billable). Gate `scan` behind write
 * access in read-only deployments.
 */
import type { Command } from "commander";
import { buildProgram as buildLocalfalconProgram } from "@mirage-cli/localfalcon-cli";
import {
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

export function buildProgram(): Command {
  const program = cachedProgram ?? buildLocalfalconProgram();
  cachedProgram = program;
  return program;
}

let cachedFn: MirageCommandFn | null = null;

export const localfalconCommand: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

let cachedResource: Resource | null = null;
export async function localfalconResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const m = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: m.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new m.RegisteredCommand({
      name: "localfalcon",
      resource: null,
      spec: new m.CommandSpec({
        rest: new m.Operand({ kind: m.OperandKind.TEXT }),
        description: "Local Falcon geo-grid rank tracking CLI",
      }),
      fn: fn as unknown as Parameters<typeof m.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "localfalcon",
    isRemote: true,
    prompt:
      "Local Falcon CLI — geo-grid local rank tracking. Auth via LOCALFALCON_API_KEY env var. " +
      "Read commands: `locations` (saved locations), `reports` (existing scans with ARP/ATRP/SoLV + map image URLs), " +
      "`report <key>` (one full report), `keywords` (keyword rollups). `scan` runs a NEW grid scan and is BILLABLE. " +
      "Use `localfalcon --help` to discover subcommands.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
