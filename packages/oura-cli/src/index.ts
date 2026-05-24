/**
 * Library entrypoint. Exposes `buildProgram()` for in-process wrappers like
 * `@mirage-cli/oura`, plus auth helpers and formatters.
 */
export { buildProgram } from "./cli.ts";
export {
  getToken,
  loadConfig,
  loadStoredTokens,
  saveConfig,
  saveTokens,
  deleteTokens,
  refreshAccessToken,
  CONFIG_DIR,
  CONFIG_FILE,
  TOKEN_FILE,
} from "./auth.ts";
export type { Config, StoredTokens } from "./auth.ts";
