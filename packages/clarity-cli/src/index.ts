/**
 * Library entrypoint. Exposes `buildProgram()` for in-process wrappers like
 * `@mirage-cli/clarity`, plus the typed API client functions and types.
 */
export { buildProgram } from "./cli.ts";
export {
  askDashboard,
  listRecordings,
  queryDocs,
  projectLiveInsights,
} from "./api.ts";
export { buildFilters, type SessionFlags } from "./filters.ts";
export { formatOutput } from "./formatter.ts";
export type {
  Config,
  ClarityFilters,
  SortBy,
  InsightsDimension,
} from "./types.ts";
