/**
 * @mirage-cli/ga4 — Google Analytics 4 CLI wrapped as an importable Commander
 * program plus a ready-made mirage CommandFn.
 *
 * ## Env vars
 *
 * Auth (any of):
 *
 * - `GA4_OAUTH_ACCESS_TOKEN` — raw bearer token (no refresh)
 * - `GA4_OAUTH_CLIENT_ID` + `GA4_OAUTH_CLIENT_SECRET` — for `ga4 login`
 * - `GA_PROFILE` — named profile under ~/.config/google-analytics-cli/profiles/
 * - `GOOGLE_APPLICATION_CREDENTIALS` — service account JSON path
 *
 * Targeting:
 *
 * - `GA_PROPERTY_ID` — default property ID
 *
 * ## Worker compatibility
 *
 * The underlying CLI uses `@google-analytics/{data,admin}` which pull in
 * `google-gax` + gRPC. These do not run under workerd — wrap this only in
 * Node/Bun environments. For worker-side usage, call the Data API REST
 * endpoints directly with `GA4_OAUTH_ACCESS_TOKEN`.
 */

import type { Command } from "commander";
import { buildProgram as buildGa4Program } from "@mirage-cli/ga4-cli";
import {
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildGa4Program();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

export const ga4Command: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

let cachedResource: Resource | null = null;
export async function ga4Resource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const m = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: m.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new m.RegisteredCommand({
      name: "ga4",
      resource: null,
      spec: new m.CommandSpec({
        rest: new m.Operand({ kind: m.OperandKind.TEXT }),
        description: "Google Analytics 4 CLI (Data + Admin APIs)",
      }),
      fn: fn as unknown as Parameters<typeof m.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "ga4",
    isRemote: true,
    prompt:
      "Google Analytics 4 CLI. Auth via `ga4 login` (PKCE), GA4_OAUTH_ACCESS_TOKEN env, " +
      "service-account file, or Application Default Credentials. Use `ga4 --help` to discover subcommands.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
