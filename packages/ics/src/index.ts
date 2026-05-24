/**
 * @mirage-cli/ics — ICS / iCal calendar CLI wrapped as an importable Commander
 * program plus a ready-made mirage CommandFn.
 *
 *   import { icsCommand, buildProgram } from "@mirage-cli/ics";
 *
 * ## Worker compatibility
 *
 * Event queries (`today`, `week`, `next`, `events`) fetch ICS feeds via
 * `fetch()` and parse with ical.js — workerd-safe. The config subcommands
 * (`add`, `list`, `remove`) read/write `~/.config/ics-cli/config.json` via
 * `node:fs` and only work on Node/Bun.
 *
 * ## Read/write boundary
 *
 * `add` / `remove` mutate the local calendar config file. The remote ICS
 * feed itself is never written to. Suitable for LLM drivers.
 */
import type { Command } from "commander";
import { buildProgram as buildIcsProgram } from "@mirage-cli/ics-cli";
import {
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildIcsProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

export const icsCommand: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

let cachedResource: Resource | null = null;
export async function icsResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const m = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: m.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new m.RegisteredCommand({
      name: "ics-cli",
      resource: null,
      spec: new m.CommandSpec({
        rest: new m.Operand({ kind: m.OperandKind.TEXT }),
        description: "ICS / iCal calendar CLI",
      }),
      fn: fn as unknown as Parameters<typeof m.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "ics",
    isRemote: true,
    prompt:
      "ICS / iCal calendar CLI. Query events from saved feeds (--calendar <name>) " +
      "or an ad-hoc URL (--url ...). Use `today`, `week`, `next -n N`, or `events --from … --to …`. " +
      "All event queries are read-only; `add`/`remove` modify local config only.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
