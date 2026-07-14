/**
 * Rapid URL Indexer CLI wrapped as an importable Mirage command.
 *
 * `projects create` spends account credits. Consumers should gate that command
 * at the workspace layer when exposing this mount to untrusted callers.
 */
import type { Command } from "commander";
import { buildProgram as buildRapidUrlIndexerProgram } from "@mirage-cli/rapidurlindexer-cli";
import {
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildRapidUrlIndexerProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

export const rapidurlindexerCommand: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

let cachedResource: Resource | null = null;

export async function rapidurlindexerResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const mirage = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: mirage.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new mirage.RegisteredCommand({
      name: "rapidurlindexer",
      resource: null,
      spec: new mirage.CommandSpec({
        rest: new mirage.Operand({ kind: mirage.OperandKind.TEXT }),
        description: "Rapid URL Indexer CLI (project creation spends credits)",
      }),
      fn: fn as unknown as Parameters<typeof mirage.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "rapidurlindexer",
    isRemote: true,
    prompt:
      "Rapid URL Indexer CLI. Auth uses RAPIDURLINDEXER_API_KEY. " +
      "Read commands inspect credits, projects, status, and reports. " +
      "`projects create` submits URLs and spends credits; it is not automatically retried. " +
      "Reports normally become available after 96 hours. Use `rapidurlindexer --help` for usage.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
