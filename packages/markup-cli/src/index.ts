/**
 * Library entrypoint. `buildProgram()` for in-process wrappers such as
 * `@mirage-cli/markup`, plus the MCP client for calling Markup directly.
 */
export { buildProgram, VERSION } from "./cli.ts";
export { callTool, listTools, MarkupError, parseRpcBody, resolveClient, TOOL } from "./client.ts";
export type { ApiClientOpts, ToolInfo } from "./client.ts";
export { DEFAULT_HOST } from "./config.ts";
export type { CLIConfig, OAuthState } from "./config.ts";
