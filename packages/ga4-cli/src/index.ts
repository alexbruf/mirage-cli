/**
 * Library entrypoint. Exposes `buildProgram()` for in-process wrappers like
 * `@mirage-cli/ga4`, plus the OAuth state helpers and auth client factories.
 */
export { buildProgram } from "./cli.ts";
export {
  createAdminClient,
  createAdminAlphaClient,
  createDataClient,
  getDefaultCredentialsPath,
  getProfilePath,
  getProfilesDir,
  listProfiles,
  setCredentialsPath,
  setProfile,
  version,
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
