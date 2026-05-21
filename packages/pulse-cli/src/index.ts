/**
 * Library entrypoint. Exposes `buildProgram()` for in-process wrappers like
 * `@mirage-cli/pulse`, plus the typed API client and types.
 */
export { buildProgram } from "./cli.ts";
export { ApiClient, ApiError, type RequestOptions } from "./client.ts";
export {
  loadSession,
  saveSession,
  clearSession,
  requireSession,
  getDefaultBaseUrl,
  SESSION_PATH_FOR_DISPLAY,
  type Session,
} from "./config.ts";
export type { Job, CreateJobOpts } from "./commands/jobs.ts";
export type { OutputOpts, Format } from "./output.ts";
