/**
 * Library entrypoint. Exposes `buildProgram()` for in-process wrappers like
 * `@mirage-cli/seogets`, plus the MCP client and output helpers.
 */
export { buildProgram } from "./cli.ts";
export {
  BoundedMinHeap,
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
export { McpClient, McpError, unwrapToolResult, type McpClientOpts, type McpTool } from "./mcp.ts";
export { renderOutput, writeObject, writeOutput, type OutputOpts, type Format } from "./output.ts";
