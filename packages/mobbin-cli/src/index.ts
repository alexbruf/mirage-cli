/**
 * Library entrypoint. `buildProgram()` for in-process wrappers such as
 * `@mirage-cli/mobbin`, plus the MCP client for calling Mobbin directly.
 */
export { buildProgram, VERSION } from "./cli.ts";
export { callTool, listTools, MobbinError, parseRpcBody, resolveClient, structured, TOOL } from "./client.ts";
export type { ApiClientOpts, ContentBlock, ToolInfo, ToolResult } from "./client.ts";
export { DEFAULT_MCP_URL } from "./config.ts";
export type { CLIConfig, OAuthState, Registration } from "./config.ts";
export { discover, ensureClient, pkce, refresh } from "./oauth.ts";
export type { AuthServer, TokenResponse } from "./oauth.ts";
