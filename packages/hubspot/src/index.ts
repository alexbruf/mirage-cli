/**
 * @mirage-cli/hubspot — HubSpot CLI wrapped as an importable Commander program
 * plus a ready-made mirage CommandFn.
 *
 *   import { hubspotCommand, buildProgram } from "@mirage-cli/hubspot";
 *
 * Because `@mirage-cli/hubspot-cli` exports `buildProgram()` directly (no
 * auto-parse side effects on import), this wrapper is just a thin convenience
 * layer.
 *
 * ## Env vars
 *
 * - `HUBSPOT_ACCESS_TOKEN=...` — a private app access token or any OAuth/access
 *   token. Used directly as a bearer; simplest for headless/CI and workers.
 * - `HUBSPOT_PERSONAL_ACCESS_KEY=...` — a personal access key (the credential
 *   `hs account auth` uses). Exchanged for a short-lived access token at call
 *   time and cached in process. Pair with `HUBSPOT_ACCOUNT_ID` to pin a portal.
 * - `HUBSPOT_API_BASE_URL=https://api.hubapi.com` — base URL override.
 *
 * On a workstation, no env is needed: the CLI reuses the accounts in
 * `~/.hscli/config.yml` (run `hs account auth`); select one with `--account`.
 *
 * ## Worker compatibility
 *
 * All subcommands are pure `fetch` (the client is GET + read-only `/search`
 * POST only — read-only by construction). `node:fs` is only touched when env
 * credentials are absent and `~/.hscli/config.yml` is consulted — set
 * `HUBSPOT_ACCESS_TOKEN` in workerd and never hit it.
 */

import type { Command } from "commander";
import { buildProgram as buildHubSpotProgram } from "@mirage-cli/hubspot-cli";
import {
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

/**
 * Build (or return the cached) hubspot Commander program. Synchronous,
 * idempotent — hubspot-cli's `buildProgram` is a pure function.
 */
export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildHubSpotProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

/**
 * Mirage CommandFn for the HubSpot CLI.
 *
 *   import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
 *   import { hubspotCommand } from "@mirage-cli/hubspot";
 *
 *   export const hubspot = command({
 *     name: "hubspot",
 *     resource: null,
 *     spec: new CommandSpec({
 *       rest: new Operand({ kind: OperandKind.TEXT }),
 *       description: "HubSpot CLI (read-only CRM/marketing/CMS)",
 *     }),
 *     fn: hubspotCommand,
 *   });
 */
export const hubspotCommand: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

let cachedResource: Resource | null = null;
export async function hubspotResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const m = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: m.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new m.RegisteredCommand({
      name: "hubspot",
      resource: null,
      spec: new m.CommandSpec({
        rest: new m.Operand({ kind: m.OperandKind.TEXT }),
        description: "HubSpot CLI (read-only CRM/marketing/CMS)",
      }),
      fn: fn as unknown as Parameters<typeof m.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "hubspot",
    isRemote: true,
    prompt:
      "HubSpot CLI — read-only access to api.hubapi.com: CRM (contacts, companies, deals, " +
      "tickets, products, custom objects via `crm object`), CRM properties/owners/pipelines/" +
      "associations, marketing (forms, emails, campaigns), and CMS (blog posts/authors/tags, " +
      "site pages, HubDB). Grammar mirrors the official `hs` CLI: `hubspot <noun> <verb>`. " +
      "Auth via HUBSPOT_ACCESS_TOKEN (private app token), HUBSPOT_PERSONAL_ACCESS_KEY, or the " +
      "~/.hscli/config.yml login selected with --account. Output defaults to JSON " +
      "(-f jsonl|table|csv available). Use `hubspot --help` to discover subcommands.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
