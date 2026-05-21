/**
 * Library entrypoint. Exposes `buildProgram()` for in-process wrappers like
 * `@mirage-cli/ga4`, plus the auth helpers and REST primitives so callers
 * can hit GA4 directly without going through the CLI.
 */
export { buildProgram } from "./cli.ts";
export {
  authHeaders,
  getDefaultCredentialsPath,
  getProfilePath,
  getProfilesDir,
  listProfiles,
  requireAccessToken,
  resolveAccessToken,
  setCredentialsPath,
  setProfile,
  signServiceAccountJWT,
  version,
  type ServiceAccountKey,
} from "./auth.ts";
export {
  clearOAuthState,
  loadOAuthState,
  login,
  logout,
  oauthFilePath,
  refreshIfNeeded,
  type LoginOpts,
  type OAuthState,
} from "./oauth.ts";
export {
  ADMIN_ALPHA,
  ADMIN_BETA,
  DATA_BETA,
  GA4ApiError,
  gaRequest,
  listAll,
  listAllPost,
  type RequestOpts,
} from "./rest.ts";
