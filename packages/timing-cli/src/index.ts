/**
 * Library entrypoint. Exposes `buildProgram()` for in-process wrappers like
 * `@mirage-cli/timing`, plus the typed API client and types.
 */
export { buildProgram } from "./cli.ts";
export { TimingClient } from "./client.ts";
export { getToken, getBaseUrl, saveConfig, getConfigPath } from "./config.ts";
export type {
  GlobalOptions,
  OutputFormat,
  TimingProject,
  TimingEntry,
  TimingTeam,
  TimingTeamMember,
  ReportEntry,
} from "./types.ts";
