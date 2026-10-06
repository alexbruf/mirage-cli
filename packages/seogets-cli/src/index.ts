/**
 * Library entrypoint. Exposes `buildProgram()` for in-process wrappers like
 * `@mirage-cli/seogets`, plus the MCP client and output helpers.
 */
export { buildProgram } from "./cli.ts";
export {
  BoundedMinHeap,
  SEARCH_METRICS,
  SERVER_ROW_CAP,
  WEB_METRICS,
  gscCompare,
  gscTopBy,
  metricOf,
  normalizeGscPage,
  pageHasMore,
  parseGscTsv,
  type GscCompareParams,
  type GscCompareResult,
  type GscDimension,
  type GscMetric,
  type GscPage,
  type GscPageArgs,
  type GscPager,
  type GscRow,
  type GscTopParams,
  type GscTopResult,
} from "./gsc-top.ts";
export {
  McpClient,
  McpError,
  PERFORMANCE_TOOL,
  unwrapToolResult,
  type McpClientOpts,
  type McpTool,
} from "./mcp.ts";
export {
  MAX_LIST_PAGES,
  changeRows,
  collectPages,
  hasMore,
  listRows,
  pageRows,
  performanceRows,
  performanceWarnings,
  queryRows,
  type PageRow,
} from "./site-data.ts";
export { renderOutput, writeObject, writeOutput, type OutputOpts, type Format } from "./output.ts";
