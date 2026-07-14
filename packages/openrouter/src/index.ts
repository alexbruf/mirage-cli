/**
 * OpenRouter CLI wrapped as an importable Commander program and Mirage command.
 * Every remote operation is fetch-only. Chat creates billable model inference,
 * so hosts should write-gate the `chat` subcommand on read-only mounts.
 */
import type { Command } from "commander";
import { buildProgram as buildOpenRouterProgram } from "@mirage-cli/openrouter-cli";
import {
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildOpenRouterProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

export const openrouterCommand: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

let cachedResource: Resource | null = null;

export async function openrouterResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const mirage = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: mirage.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new mirage.RegisteredCommand({
      name: "openrouter",
      resource: null,
      spec: new mirage.CommandSpec({
        rest: new mirage.Operand({ kind: mirage.OperandKind.TEXT }),
        description: "OpenRouter model catalog, quota, generation metadata, and chat CLI",
      }),
      fn: fn as unknown as Parameters<typeof mirage.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "openrouter",
    isRemote: true,
    prompt:
      "OpenRouter CLI. Auth via OPENROUTER_API_KEY. Read commands: `models`, `providers list`, " +
      "`key`, and `generation <id>`. `chat` creates billable inference and should require a " +
      "write-mode mount. Use `openrouter --help` for request-file, routing, streaming, and output options.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
