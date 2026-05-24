/**
 * @mirage-cli/oura — Oura Ring CLI wrapped as an importable Commander program
 * plus a ready-made mirage CommandFn.
 *
 *   import { ouraCommand, buildProgram } from "@mirage-cli/oura";
 *
 * ## Env vars
 *
 * - `OURA_ACCESS_TOKEN=...` — personal access token (simplest auth, workerd-safe).
 * - `OURA_CLIENT_ID` / `OURA_CLIENT_SECRET` — OAuth2 client creds (for `oura login` flow).
 *
 * ## Worker compatibility
 *
 * Data subcommands (`daily-activity`, `sleep`, `heart-rate`, etc.) are fetch-only
 * and run in workerd. Auth subcommands (`setup`, `login`, `logout`) touch
 * `node:fs` / `node:http` and only work in Node/Bun CLI mode.
 *
 * ## Read/write boundary
 *
 * All exposed Oura API commands are read-only (GET endpoints). No mutating
 * commands are wrapped.
 */
import type { Command } from "commander";
import { buildProgram as buildOuraProgram } from "@mirage-cli/oura-cli";
import {
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildOuraProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

export const ouraCommand: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

let cachedResource: Resource | null = null;
export async function ouraResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const m = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: m.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new m.RegisteredCommand({
      name: "oura",
      resource: null,
      spec: new m.CommandSpec({
        rest: new m.Operand({ kind: m.OperandKind.TEXT }),
        description: "Oura Ring CLI",
      }),
      fn: fn as unknown as Parameters<typeof m.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "oura",
    isRemote: true,
    prompt:
      "Oura Ring CLI (v2 API). Auth via OURA_ACCESS_TOKEN env var (simplest) " +
      "or `oura login` (OAuth2). All commands are read-only. " +
      "Use `oura --help` to discover subcommands.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
