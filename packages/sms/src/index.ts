/**
 * @mirage-cli/sms — SMS inbox CLI wrapped as an importable Commander program
 * plus a ready-made mirage CommandFn.
 *
 *   import { smsCommand, buildProgram } from "@mirage-cli/sms";
 *
 * ## Env vars
 *
 * - `SMS_SERVER_URL=...` — base URL of the Cloudflare Worker (e.g. https://sms.clanqi.org).
 * - `SMS_API_KEY=...`    — bearer token for the worker.
 *
 * ## Worker compatibility
 *
 * All API calls are fetch-only — workerd-safe. `config set` writes to
 * `~/.config/sms/config.json` (Node/Bun only).
 *
 * ## Read/write boundary
 *
 * **Read:** `list`, `conversations`, `read`, `search`, `contact`, `config show`.
 * **Write:** `send`, `reply`, `mark-read`, `mark-unread`, `delete`, `config set`.
 * Write commands send real SMS via a paired Android phone. LLM drivers should
 * gate `send` / `reply` with explicit user confirmation.
 */
import type { Command } from "commander";
import { buildProgram as buildSmsProgram } from "@mirage-cli/sms-cli";
import {
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildSmsProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

export const smsCommand: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

let cachedResource: Resource | null = null;
export async function smsResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const m = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: m.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new m.RegisteredCommand({
      name: "sms",
      resource: null,
      spec: new m.CommandSpec({
        rest: new m.Operand({ kind: m.OperandKind.TEXT }),
        description: "SMS inbox CLI",
      }),
      fn: fn as unknown as Parameters<typeof m.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "sms",
    isRemote: true,
    prompt:
      "SMS inbox CLI (Cloudflare Worker + Android SMS Gateway). Auth via SMS_SERVER_URL " +
      "and SMS_API_KEY env vars. Read: list/read/search/conversations/contact. " +
      "Write: send/reply send real SMS. Use `sms --help`.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
