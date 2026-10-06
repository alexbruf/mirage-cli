/**
 * Library entrypoint. Exposes `buildProgram()` for in-process wrappers like
 * `@mirage-cli/windsor`, plus the client, the WHERE parser, and the renderer
 * so consumers can build their own programs against the same pieces.
 */
export { buildProgram, dateParams, queryParams } from "./cli.ts";
export { WindsorClient, type Row } from "./client.ts";
export { parseWhere, type Condition, type FilterGroup, type Value } from "./where.ts";
export { parseFormat, render, type Format } from "./format.ts";
