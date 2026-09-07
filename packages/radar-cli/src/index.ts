/**
 * Library entrypoint. Exposes `buildProgram()` for in-process wrappers like
 * `@mirage-cli/radar`, plus the typed API client and types.
 */
export { buildProgram } from "./cli.ts";
export {
  ApiClient,
  ApiError,
  type RequestOptions,
  type ListResponse,
  type DetailResponse,
  type ListParams,
  type SseRequestOptions,
  DEFAULT_SSE_TIMEOUT_MS,
  parseSseStream,
} from "./client.ts";
export {
  ONBOARDING_SECTIONS,
  parseJsonOption,
  parseOnboardingSection,
  registerOnboardingCommands,
  type OnboardingSection,
} from "./commands/onboarding.ts";
export {
  loadSession,
  loadFileSession,
  saveSession,
  clearSession,
  requireSession,
  setActiveOrg,
  getDefaultBaseUrl,
  SESSION_PATH_FOR_DISPLAY,
  type Session,
} from "./config.ts";
export type { OutputOpts, Format } from "./output.ts";
