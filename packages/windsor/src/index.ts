/**
 * @mirage-cli/windsor — Windsor.ai CLI wrapped as an importable Commander
 * program plus a ready-made mirage CommandFn.
 *
 *   import { windsorCommand, buildProgram } from "@mirage-cli/windsor";
 *
 * ## Env vars
 *
 * - `WINDSOR_API_KEY=...` — Windsor.ai API key (the only credential needed).
 *   Get one at https://onboard.windsor.ai/app/data-preview.
 *
 * ## Worker compatibility
 *
 * Every subcommand is fetch-only (Windsor REST) — no `node:fs`, `node:http`,
 * or interactive auth on any path — so the whole program runs in workerd.
 *
 * ## Read/write boundary
 *
 * All exposed commands are read-only GETs. Windsor's write actions
 * (`/{connector}/actions`) are deliberately not wrapped.
 */
import type { Command } from "commander";
import { buildProgram as buildWindsorProgram } from "@mirage-cli/windsor-cli";
import {
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildWindsorProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

export const windsorCommand: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

let cachedResource: Resource | null = null;
export async function windsorResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const m = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: m.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new m.RegisteredCommand({
      name: "windsor",
      resource: null,
      spec: new m.CommandSpec({
        rest: new m.Operand({ kind: m.OperandKind.TEXT }),
        description: "Windsor.ai CLI",
      }),
      fn: fn as unknown as Parameters<typeof m.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "windsor",
    isRemote: true,
    prompt:
      "Windsor.ai CLI: read data from any of Windsor's 350+ connectors (Google Ads, GA4, " +
      "Meta, LinkedIn, TikTok, GBP, Search Console, Shopify, ...). Auth via WINDSOR_API_KEY " +
      "env var. Explore with `connectors`, `accounts <connector>`, `fields <connector> " +
      "[search]`, `options <connector>`; fetch rows with `query <connector> -F <fields> " +
      "[-w \"spend > 100 and campaign like '%brand%'\"] [-s 90d] [-f csv]`. Read-only. " +
      "Use `windsor --help` for examples.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
