/**
 * Library entrypoint. Exposes `buildProgram()` for in-process wrappers like
 * `@mirage-cli/gbp`, plus the pluggable data-source contract and the Windsor
 * backend so consumers can build their own programs against the same types.
 */
export { buildProgram } from "./cli.ts";
export { WindsorSource } from "./sources/windsor.ts";
export { render, type Format } from "./format.ts";
export type {
  Business,
  DataSource,
  DateRange,
  QueryOpts,
  Row,
} from "./sources/types.ts";
