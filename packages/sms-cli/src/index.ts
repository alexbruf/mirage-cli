/**
 * Library entrypoint. Exposes `buildProgram()` for in-process wrappers like
 * `@mirage-cli/sms`, plus the client and shared types.
 */
export { buildProgram } from "./cli.ts";
export { SmsClient } from "./client.ts";
export { getCliConfig, loadFileConfig, saveFileConfig } from "./shared/config.ts";
export type { Message, Conversation, Contact } from "./shared/types.ts";
