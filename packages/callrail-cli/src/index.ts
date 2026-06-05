/**
 * Library entrypoint. Exposes `buildProgram()` for in-process wrappers like
 * `@mirage-cli/callrail`, plus the read-only API client, config, and types.
 */
export { buildProgram } from "./cli.ts";
export {
  CallRailClient,
  ApiError,
  type ClientOptions,
  type ListEnvelope,
  type Query,
} from "./client.ts";
export {
  loadFileConfig,
  saveFileConfig,
  mergedProfiles,
  parseEnvProfiles,
  resolveCredentials,
  fingerprint,
  getDefaultBaseUrl,
  CONFIG_PATH_FOR_DISPLAY,
  type Profile,
  type FileConfig,
  type ResolvedCredentials,
  type CredentialFlags,
} from "./config.ts";
export { renderList, renderObject, parseFormat, FORMATS, type Format } from "./output.ts";
