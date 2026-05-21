/**
 * @mirage-cli/clarity — Microsoft Clarity CLI wrapped as an importable
 * Commander program plus a ready-made mirage CommandFn.
 *
 *   import { clarityCommand, buildProgram } from "@mirage-cli/clarity";
 *
 * ## Env vars
 *
 * - `CLARITY_API_TOKEN=...` — bearer token (generate at Clarity → Settings → Data Export).
 *
 * ## Worker compatibility
 *
 * The CLI is `fetch`-based with no `node:fs` / `child_process` in the hot path
 * for API calls. `auth` subcommand touches `node:fs` (config write) — fine on
 * Bun/Node, will fail at runtime in workerd. Read-only subcommands (`ask`,
 * `sessions`, `ai-traffic`, `ai-sessions`, `docs`, `insights`, `top-pages`,
 * `web-vitals`, `errors`, `traffic`) work in workerd if `CLARITY_API_TOKEN`
 * is in the env.
 */

import type { Command } from "commander";
import { buildProgram as buildClarityProgram } from "@mirage-cli/clarity-cli";
import {
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildClarityProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

export const clarityCommand: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

let cachedResource: Resource | null = null;
export async function clarityResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const m = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: m.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new m.RegisteredCommand({
      name: "clarity",
      resource: null,
      spec: new m.CommandSpec({
        rest: new m.Operand({ kind: m.OperandKind.TEXT }),
        description: "Microsoft Clarity CLI",
      }),
      fn: fn as unknown as Parameters<typeof m.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "clarity",
    isRemote: true,
    prompt:
      "Microsoft Clarity CLI. Auth via `clarity auth <token>` or CLARITY_API_TOKEN env var. " +
      "Use `clarity --help` to discover subcommands (ask, sessions, ai-traffic, insights, …).",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
