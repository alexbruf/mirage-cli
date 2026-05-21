/**
 * Library entrypoint. Exposes `buildProgram()` for in-process wrappers like
 * `@mirage-cli/seogets`, plus the MCP client and output helpers.
 */
export { buildProgram } from "./cli.ts";
export { McpClient, McpError, unwrapToolResult, type McpClientOpts, type McpTool } from "./mcp.ts";
export { writeObject, writeOutput, type OutputOpts, type Format } from "./output.ts";
