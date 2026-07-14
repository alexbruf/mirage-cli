/**
 * OpenRouter CLI wrapped as an importable Commander program and Mirage command.
 * Every remote operation is fetch-only. Chat and image generation create
 * billable model inference, so hosts should write-gate `chat` and
 * `images generate` on read-only mounts.
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
        description: "OpenRouter model and image catalog, quota, generation metadata, chat, and image CLI",
      }),
      fn: fn as unknown as Parameters<typeof mirage.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "openrouter",
    isRemote: true,
    prompt:
      "OpenRouter CLI. Auth via OPENROUTER_API_KEY. Read commands: `models`, `images models`, " +
      "`images endpoints`, `providers list`, `key`, and `generation <id>`. `chat` and " +
      "`images generate` create billable inference and should require a write-mode mount. " +
      "Write generated images directly to a mounted output such as `/sessions/<id>/image.png`.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
