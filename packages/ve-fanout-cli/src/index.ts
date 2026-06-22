/**
 * Library entrypoint. Exposes `buildProgram()` for in-process wrappers like
 * `@mirage-cli/ve-fanout`, plus the HTTP client and config helpers so consumers
 * can build their own programs against the same VE Fanout API.
 */
export { buildProgram } from './cli.ts';
export {
	ApiClient,
	type ClientConfig,
	type ListResponse,
	type DetailResponse,
} from './client.ts';
export { configDir, defaultApiUrl, envToken, envOrgId } from './config.ts';
