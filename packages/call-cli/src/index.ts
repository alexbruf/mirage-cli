/**
 * Library entrypoint. Exposes `buildProgram()` for in-process wrappers like
 * `@mirage-cli/call`, plus the client and shared types.
 */
export { buildProgram } from "./cli.ts";
export { CallClient } from "./client.ts";
export { getCliConfig, loadFileConfig, saveFileConfig } from "./shared/config.ts";
export type { CallState, AudioMeta, HealthResponse } from "./shared/types.ts";
