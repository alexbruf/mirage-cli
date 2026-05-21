/**
 * Library entrypoint. Exposes `buildProgram()` for in-process wrappers like
 * `@mirage-cli/presscart`, plus the typed API client and types.
 */
export { buildProgram } from "./cli.ts";
export { ApiClient, ApiError, type RequestOptions } from "./client.ts";
export {
  loadSession,
  saveSession,
  clearSession,
  requireSession,
  getDefaultBaseUrl,
  SESSION_PATH_FOR_DISPLAY,
  type Session,
} from "./config.ts";
export type { OutputOpts, Format } from "./output.ts";
export type { TokenInfo } from "./auth.ts";
export type {
  CreateCampaignBody,
  ListOpts as ListCampaignsOpts,
} from "./commands/campaigns.ts";
export type { CheckoutBody, CheckoutLineItem } from "./commands/orders.ts";
export type { ListOutletsOpts } from "./commands/outlets.ts";
export type { ListingsOpts } from "./commands/products.ts";
