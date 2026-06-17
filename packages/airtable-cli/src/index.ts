/**
 * Library entrypoint. Exposes `buildProgram()` for in-process wrappers like
 * `@mirage-cli/airtable`, plus the read-only API client, config, and types.
 */
export { buildProgram } from "./cli.ts";
export {
  AirtableClient,
  ApiError,
  type ClientOptions,
  type ListEnvelope,
  type Query,
} from "./client.ts";
export {
  resolveToken,
  resolveBase,
  fingerprint,
  getDefaultBaseUrl,
  type CredentialFlags,
  type ResolvedToken,
} from "./config.ts";
export { renderList, renderObject, parseFormat, FORMATS, type Format } from "./output.ts";
