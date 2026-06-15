/**
 * Library entrypoint. Exposes `buildProgram()` for in-process wrappers like
 * `@mirage-cli/localfalcon`, plus the pluggable data-source contract and the
 * Local Falcon backend so consumers can build their own programs against the
 * same types.
 */
export { buildProgram } from "./cli.ts";
export { LocalFalconSource } from "./sources/localfalcon.ts";
export { render, type Format } from "./format.ts";
export type {
  DataSource,
  KeywordsFilter,
  LocationsFilter,
  ReportsFilter,
  Row,
  RunScanInput,
} from "./sources/types.ts";
