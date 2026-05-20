/**
 * Library entrypoint. Exposes the mirage primitives, every command, the
 * generic `request()` helper for programmatic use, and `buildProgram()` for
 * in-process wrappers like @mirage-cli/ahrefs.
 */
export * from "./framework/index.ts";
export { request } from "./client.ts";
export type { ApiError, RequestOptions } from "./client.ts";

// Commander program builder (for in-process wrappers)
export { buildProgram } from "./cli.ts";

// Command groups
export { keywordsGroup } from "./commands/keywords.ts";
export { siteExplorerGroup } from "./commands/site-explorer.ts";
export { rankTrackerGroup } from "./commands/rank-tracker.ts";
export { siteAuditGroup } from "./commands/site-audit.ts";
export { gscGroup } from "./commands/gsc.ts";
export { accountGroup } from "./commands/account.ts";

// Individual commands (lift any into a Mirage workspace or call via invoke())
export {
  keywordsOverviewCmd,
  keywordsMatchingTermsCmd,
  keywordsRelatedTermsCmd,
  keywordsSearchSuggestionsCmd,
  keywordsVolumeByCountryCmd,
  keywordsVolumeHistoryCmd,
} from "./commands/keywords.ts";
export {
  siteExplorerOverviewCmd,
  siteExplorerDomainRatingCmd,
  siteExplorerBacklinksCmd,
  siteExplorerRefdomainsCmd,
  siteExplorerAnchorsCmd,
  siteExplorerOrganicKeywordsCmd,
  siteExplorerOrganicCompetitorsCmd,
  siteExplorerTopPagesCmd,
} from "./commands/site-explorer.ts";
export { batchAnalysisCmd } from "./commands/batch-analysis.ts";
export { accountLimitsCmd } from "./commands/account.ts";
