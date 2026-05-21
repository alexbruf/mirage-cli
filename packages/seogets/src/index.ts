/**
 * @mirage-cli/seogets — SEO Gets MCP CLI wrapped as an importable Commander
 * program plus a ready-made mirage CommandFn.
 *
 * ## Env vars
 *
 * - `SEOGETS_MCP_TOKEN=...` — required bearer token
 * - `SEOGETS_MCP_URL=...`   — optional endpoint override
 *
 * ## Worker compatibility
 *
 * Pure `fetch` — no `node:fs` / `child_process`. Runs in workerd as long as
 * `SEOGETS_MCP_TOKEN` is available in the env.
 */

import type { Command } from "commander";
import { buildProgram as buildSeogetsProgram } from "@mirage-cli/seogets-cli";
import {
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildSeogetsProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

export const seogetsCommand: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

let cachedResource: Resource | null = null;
export async function seogetsResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const m = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: m.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new m.RegisteredCommand({
      name: "seogets",
      resource: null,
      spec: new m.CommandSpec({
        rest: new m.Operand({ kind: m.OperandKind.TEXT }),
        description: "SEO Gets MCP CLI",
      }),
      fn: fn as unknown as Parameters<typeof m.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "seogets",
    isRemote: true,
    prompt:
      "SEO Gets MCP CLI. Auth via SEOGETS_MCP_TOKEN env var. " +
      "Subcommands: tools, sites, gsc, indexing overview, indexing status, call. Use `seogets --help` for details.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
