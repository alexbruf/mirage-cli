/**
 * @mirage-cli/core — wrap a Commander.js CLI for in-process execution in
 * Cloudflare Workers, Bun, or Node. ALS-based per-call isolation, true
 * streaming output, ByteSource stdin. Used directly, or as a building block
 * for individual @mirage-cli/<vendor> wrapper packages.
 *
 * Primary: `streamCommander` (streaming) and `runCommander` (buffered).
 * Mirage integration: `toMirageCommandFn`.
 * Pre-flight scan: `checkCompatSource`.
 * Lower-level (not concurrency-safe): `captureStdio`.
 */

export { captureStdio, type CaptureResult } from "./capture.ts";
export {
  runCommander,
  streamCommander,
  toMirageCommandFn,
  type ByteSource,
  type Command,
  type CommanderProgram,
  type IOResultCtor,
  type MirageCommandFn,
  type MirageIOResult,
  type RunResult,
  type StreamOptions,
  type StreamResult,
  type ToMirageOptions,
} from "./runner.ts";
export {
  checkCompatSource,
  formatReport,
  type CompatIssue,
  type CompatReport,
} from "./compat.ts";
