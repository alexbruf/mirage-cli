import type { Command } from "commander";
import { buildProgram as buildContentDynamiteProgram } from "@mirage-cli/contentdynamite-cli";
import {
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildContentDynamiteProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

export const contentdynamiteCommand: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

let cachedResource: Resource | null = null;

export async function contentdynamiteResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const mirage = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: mirage.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new mirage.RegisteredCommand({
      name: "ve-dynamite",
      resource: null,
      spec: new mirage.CommandSpec({
        rest: new mirage.Operand({ kind: mirage.OperandKind.TEXT }),
        description: "Content Dynamite CLI (article and landing page writes spend real money)",
      }),
      fn: fn as unknown as Parameters<typeof mirage.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "contentdynamite",
    isRemote: true,
    prompt:
      "Content Dynamite CLI. Auth uses VE_DYNAMITE_TOKEN (a ved_ API token). " +
      "Read commands inspect profiles, ICP, articles, batches, landing pages, and image jobs. " +
      "`articles write`, `batches create`, `landing-pages write`, `icp regenerate`, and `images edit` spend real money per item and are never automatically retried. " +
      "Generation is asynchronous; poll with `get` instead of watch. Use `ve-dynamite --help` for usage.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
