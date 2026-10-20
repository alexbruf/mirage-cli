import type { Command } from "commander";
import { buildProgram as buildContentDynamiteProgram } from "@mirage-cli/contentdynamite-cli";
import {
  reportCost,
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildContentDynamiteProgram({ mount: true, reportCost });
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
        description: "Content Dynamite CLI (articles, GBP posts and landing pages spend real money)",
      }),
      fn: fn as unknown as Parameters<typeof mirage.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "contentdynamite",
    isRemote: true,
    prompt:
      "Content Dynamite CLI. Auth via VE_DYNAMITE_TOKEN (a ved_ API token); VE_DYNAMITE_API_URL picks the API. " +
      "Reads cover profiles, ICP, categories, design systems, articles, revisions, batches, GBP posts, landing pages and image jobs. " +
      "`articles write|reject`, `batches create`, `gbp write|batch|regenerate`, `landing-pages write|reiterate|new-version|fix-images`, " +
      "`profiles create`, `icp regenerate`, `design-system set|rescan`, `images edit` and `evals run --judge` spend real money per item " +
      "and should require a write-mode mount. Generation is asynchronous and there is no watch: poll `get` about every 10 seconds. " +
      "Use `ve-dynamite --help` for usage.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
