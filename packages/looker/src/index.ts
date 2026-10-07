/**
 * looker.so rank tracker CLI wrapped as an importable Mirage command.
 *
 * Several commands bill the org's own DataForSEO key (scans, research runs,
 * audits) or change Looker data. Consumers should gate them at the workspace
 * layer when exposing this mount to untrusted callers.
 */
import type { Command } from "commander";
import { buildProgram as buildLookerProgram } from "@mirage-cli/looker-cli";
import {
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildLookerProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

export const lookerCommand: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

let cachedResource: Resource | null = null;

export async function lookerResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const mirage = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: mirage.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new mirage.RegisteredCommand({
      name: "looker",
      resource: null,
      spec: new mirage.CommandSpec({
        rest: new mirage.Operand({ kind: mirage.OperandKind.TEXT }),
        description: "looker.so rank tracker CLI (scans and research runs spend the DataForSEO key)",
      }),
      fn: fn as unknown as Parameters<typeof mirage.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "looker",
    isRemote: true,
    prompt:
      "looker.so rank tracker CLI. Auth uses LOOKER_API_KEY. " +
      "Free reads: find, projects list|get|report, keywords list|history|diagnose, snapshot, changes, " +
      "locations, wait, gsc, and list/get on every research group. " +
      "Paid (bills the org's DataForSEO key): keywords scan|discover, audits run, backlinks run, " +
      "brand-visibility run|rerun, keyword-research run, domain-overview run|rerun, prompts run, competitor-gap run. " +
      "Start with `looker find <name>` to resolve ids. Use `looker --help` for usage.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
