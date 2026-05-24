/**
 * @mirage-cli/call — Phone call CLI wrapped as an importable Commander program
 * plus a ready-made mirage CommandFn.
 *
 *   import { callCommand, buildProgram } from "@mirage-cli/call";
 *
 * ## Env vars
 *
 * - `CALL_SERVER_URL=...`     — base URL of the Cloudflare Worker (e.g. https://call.clanqi.org).
 * - `CALL_API_KEY=...`        — bearer token for the worker.
 * - `ELEVENLABS_API_KEY=...`  — ElevenLabs API key for TTS (optional, only for TTS calls).
 *
 * ## Worker compatibility
 *
 * All API calls are fetch-only — workerd-safe. `config set` writes to
 * `~/.config/call/config.json` (Node/Bun only).
 *
 * ## Read/write boundary
 *
 * **Read:** `status`, `config show`.
 * **Write:** `call` (places a real outbound phone call with TTS or pre-uploaded
 * audio), `hangup`, `upload`, `config set`. LLM drivers must gate `call` with
 * explicit user confirmation — this dials a real number on a paired phone.
 */
import type { Command } from "commander";
import { buildProgram as buildCallProgram } from "@mirage-cli/call-cli";
import {
  toMirageCommandFn,
  type IOResultCtor,
  type MirageCommandFn,
} from "@mirage-cli/core";
import type { RegisteredCommand, Resource } from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;

export function buildProgram(): Command {
  if (cachedProgram === null) cachedProgram = buildCallProgram();
  return cachedProgram;
}

let cachedFn: MirageCommandFn | null = null;

export const callCommand: MirageCommandFn = async (accessor, paths, texts, opts) => {
  if (cachedFn === null) cachedFn = toMirageCommandFn(buildProgram());
  return cachedFn(accessor, paths, texts, opts);
};

let cachedResource: Resource | null = null;
export async function callResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const m = await import("@struktoai/mirage-core");
  const fn = toMirageCommandFn(buildProgram(), {
    IOResult: m.IOResult as unknown as IOResultCtor,
  });
  const commands: readonly RegisteredCommand[] = [
    new m.RegisteredCommand({
      name: "call",
      resource: null,
      spec: new m.CommandSpec({
        rest: new m.Operand({ kind: m.OperandKind.TEXT }),
        description: "Phone call CLI",
      }),
      fn: fn as unknown as Parameters<typeof m.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "call",
    isRemote: true,
    prompt:
      "Phone call CLI (Cloudflare Worker + Android Bluetooth/ADB bridge). " +
      "Auth via CALL_SERVER_URL and CALL_API_KEY env vars. Read: status, config show. " +
      "Write: `call <number> --text \"...\"` places a real call. Use `call --help`.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
