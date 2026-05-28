/**
 * @mirage-cli/gbp — Google Business Profile CLI wrapped as an importable
 * Commander program plus a ready-made mirage CommandFn.
 *
 *   import { gbpCommand, buildProgram } from "@mirage-cli/gbp";
 *
 * ## Env vars
 *
 * - `WINDSOR_API_KEY=...` — Windsor.ai API key (the only credential needed).
 *   Get one at https://onboard.windsor.ai/app/data-preview.
 *
 * ## Worker compatibility
 *
 * Every subcommand is fetch-only (Windsor REST) — no `node:fs`, `node:http`,
 * or interactive auth on any path — so the whole program runs in workerd.
 *
 * ## Read/write boundary
 *
 * All exposed commands are read-only (GET-style Windsor queries). No mutating
 * commands are wrapped.
 */
import type { Command } from "commander";
import { buildProgram as buildGbpProgram } from "@mirage-cli/gbp-cli";
import {
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildGbpProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

export const gbpCommand: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

let cachedResource: Resource | null = null;
export async function gbpResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const m = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: m.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new m.RegisteredCommand({
      name: "gbp",
      resource: null,
      spec: new m.CommandSpec({
        rest: new m.Operand({ kind: m.OperandKind.TEXT }),
        description: "Google Business Profile CLI",
      }),
      fn: fn as unknown as Parameters<typeof m.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "gbp",
    isRemote: true,
    prompt:
      "Google Business Profile CLI (via Windsor.ai). Auth via WINDSOR_API_KEY env var. " +
      "Query connected GBP locations (`businesses`), performance metrics, reviews, and " +
      "search keywords across one (`-b <partial name|id>`) or all (`--all`) businesses. " +
      "All commands are read-only. Use `gbp --help` to discover subcommands.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
