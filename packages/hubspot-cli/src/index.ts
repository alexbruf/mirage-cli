/**
 * Library entrypoint. Exposes `buildProgram()` for in-process wrappers like
 * `@mirage-cli/hubspot`, plus the read-only API client, token resolver, and types.
 */
export { buildProgram } from "./cli.ts";
export {
  HubSpotClient,
  ApiError,
  type ClientOptions,
  type ListEnvelope,
  type Query,
  type TokenProvider,
} from "./client.ts";
export {
  resolveAuth,
  exchangePersonalAccessKey,
  loadHsConfig,
  selectHsAccount,
  getDefaultBaseUrl,
  HS_CONFIG_PATH_FOR_DISPLAY,
  type CredentialFlags,
  type ResolvedAuth,
  type HsConfig,
  type HsAccount,
} from "./config.ts";
export { renderList, renderObject, parseFormat, FORMATS, type Format } from "./output.ts";
