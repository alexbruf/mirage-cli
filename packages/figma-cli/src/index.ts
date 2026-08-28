/**
 * Library entrypoint. Exposes `buildProgram()` for in-process wrappers like
 * `@mirage-cli/figma`, plus the API client, config resolution, and renderers.
 */
export { buildProgram } from "./cli.ts";
export {
  ApiError,
  FigmaClient,
  fetchRenderedImage,
  type ClientOptions,
  type ListEnvelope,
  type Query,
} from "./client.ts";
export {
  AUTH_SCHEMES,
  fingerprint,
  getDefaultBaseUrl,
  normalizeNodeIds,
  parseAuthScheme,
  parseFileKey,
  resolveFileKey,
  resolveTeamId,
  resolveToken,
  type AuthScheme,
  type CredentialFlags,
  type ResolvedToken,
} from "./config.ts";
export { readJsonFile, readTextFile, writeBytes } from "./fileio.ts";
export {
  FORMATS,
  mapToRows,
  parseFormat,
  renderList,
  renderObject,
  type Format,
} from "./output.ts";
