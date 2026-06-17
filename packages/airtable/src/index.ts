/**
 * @mirage-cli/airtable — Airtable CLI wrapped as an importable Commander
 * program plus a ready-made mirage CommandFn.
 *
 *   import { airtableCommand, buildProgram } from "@mirage-cli/airtable";
 *
 * Because `@mirage-cli/airtable-cli` exports `buildProgram()` directly (no
 * auto-parse side effects on import), this wrapper is just a thin convenience
 * layer.
 *
 * ## Env vars
 *
 * - `AIRTABLE_API_KEY=...` — a personal access token (PAT), used directly as a
 *   bearer (the legacy API-key auth was removed by Airtable in Feb 2024).
 *   `AIRTABLE_TOKEN` is accepted as an alias.
 * - `AIRTABLE_BASE_ID=appXXXXXXXX` — default base id (per command: `--baseId`).
 * - `AIRTABLE_API_BASE_URL=https://api.airtable.com/v0` — base URL override.
 *
 * ## Worker compatibility
 *
 * Pure `fetch` — the client is GET-only (read-only by construction), so there
 * are no Node-only imports at all. Runs unchanged under workerd.
 */

import type { Command } from "commander";
import { buildProgram as buildAirtableProgram } from "@mirage-cli/airtable-cli";
import {
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

/**
 * Build (or return the cached) airtable Commander program. Synchronous,
 * idempotent — airtable-cli's `buildProgram` is a pure function.
 */
export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildAirtableProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

/**
 * Mirage CommandFn for the Airtable CLI.
 *
 *   import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
 *   import { airtableCommand } from "@mirage-cli/airtable";
 *
 *   export const airtable = command({
 *     name: "airtable",
 *     resource: null,
 *     spec: new CommandSpec({
 *       rest: new Operand({ kind: OperandKind.TEXT }),
 *       description: "Airtable CLI (read-only bases/schema/records)",
 *     }),
 *     fn: airtableCommand,
 *   });
 */
export const airtableCommand: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

let cachedResource: Resource | null = null;
export async function airtableResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const m = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: m.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new m.RegisteredCommand({
      name: "airtable",
      resource: null,
      spec: new m.CommandSpec({
        rest: new m.Operand({ kind: m.OperandKind.TEXT }),
        description: "Airtable CLI (read-only bases/schema/records)",
      }),
      fn: fn as unknown as Parameters<typeof m.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "airtable",
    isRemote: true,
    prompt:
      "Airtable CLI — read-only access to the Airtable Web API (api.airtable.com). Command " +
      "names mirror the Airtable MCP read tools: list-bases, list-tables (alias schema), " +
      "describe-table, list-records, search-records, get-record, whoami. Flags follow the " +
      "official CLI: --baseId, --tableIdOrName, --recordId, --fields, --view, --filterByFormula, " +
      "--sort, --maxRecords, --all. Auth via AIRTABLE_API_KEY (a personal access token); " +
      "base via AIRTABLE_BASE_ID or --baseId. Output defaults to JSON (-f jsonl|table|csv " +
      "available; table/csv lift record `fields` to columns). Use `airtable --help` to discover " +
      "subcommands.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
