/**
 * Library entry point. Three layers:
 *
 * 1. Pure async API functions  — `keywordsSearchVolume`, `serpGoogleOrganic`, etc.
 *    Call them directly when you just need a `DfsResponse`.
 *
 * 2. Mirage-shaped command definitions — `keywordsSearchVolumeCmd`, etc.
 *    Built with the local `command()` factory, whose `CommandSpec` / `Option` /
 *    `Operand` / `OperandKind` / `IOResult` shapes match @struktoai/mirage-browser.
 *    Use `invoke(cmd, { texts, flags })` to run one programmatically, or
 *    `toCommander(cmd)` to mount it onto your own commander program.
 *
 * 3. `buildProgram(): Command` — a fully-assembled Commander program (same one
 *    the `dfs` CLI binary uses). For in-process wrappers like
 *    `@mirage-cli/dataforseo`.
 *
 * The CLI binary in `dist/dfs.js` is built from these same definitions.
 */

// --- Commander program builder (for in-process wrappers) ----------------------
export { buildProgram } from "./dfs.ts";

// --- Framework primitives (mirage-compatible shapes) ---------------------------
export {
  CommandSpec,
  IOResult,
  Operand,
  OperandKind,
  Option,
  ParsedArgs,
  argvToInput,
  command,
  group,
  invoke,
  mountGroup,
  ok,
  toCommander,
  type ByteSource,
  type CommandDef,
  type CommandDefInit,
  type CommandFn,
  type CommandFnResult,
  type CommandGroup,
  type CommandOpts,
  type CommandSpecInit,
  type IOResultInit,
  type InvokeInput,
  type InvokeResult,
  type OperandInit,
  type OptionInit,
  type ParsedArgsInit,
} from "./framework/index.ts";

// --- Shared output helpers (so authors of new commands can reuse them) ---------
export {
  applyOutput,
  flagBool,
  flagNum,
  flagStr,
  LOC_LANG_OPTIONS,
  OUTPUT_OPTIONS,
  resolveLocLang,
  textOp,
  type LocLangResolved,
} from "./framework/output.ts";

// --- Core HTTP client (escape hatch for callers who want the raw response) -----
export {
  call,
  extractItems,
  get,
  type CallOptions,
  type DfsResponse,
} from "./lib/client.ts";

export { loadCredentials, saveCredentials, basicAuthHeader, configPath, type Credentials } from "./lib/auth.ts";
export { findEndpoint, loadEndpoints, searchEndpoints, type EndpointInfo, type EndpointMethod } from "./lib/spec.ts";
export { render, type OutputFormat, type RenderOptions } from "./lib/output.ts";

// --- Pure async API functions --------------------------------------------------
export {
  keywordsIdeas,
  keywordsRanked,
  keywordsSearchVolume,
  keywordsSuggestions,
  type LocLang,
} from "./api/keywords.ts";
export {
  serpGoogleImages,
  serpGoogleMaps,
  serpGoogleNews,
  serpGoogleOrganic,
  serpYoutubeOrganic,
  type SerpOpts,
} from "./api/serp.ts";
export {
  backlinksAnchors,
  backlinksCompetitors,
  backlinksList,
  backlinksRanks,
  backlinksReferringDomains,
  backlinksSummary,
} from "./api/backlinks.ts";
export {
  labsBulkDifficulty,
  labsCompetitors,
  labsHistorical,
  labsIntent,
  labsIntersection,
  labsKeywordOverview,
  labsOverview,
  labsRelated,
  labsTopSearches,
} from "./api/labs.ts";
export {
  aiAsk,
  aiMentionMetrics,
  aiMentions,
  aiSearchVolume,
  aiTopDomains,
  aiTopPages,
  type AiModel,
} from "./api/ai.ts";
export { trendsDemography, trendsExplore, trendsSubregion, type TrendsType } from "./api/trends.ts";
export { listLanguages, listLocations, userData } from "./api/meta.ts";

// --- Mirage-shaped command definitions ----------------------------------------
export {
  keywordsGroup,
  keywordsIdeasCmd,
  keywordsRankedCmd,
  keywordsSearchVolumeCmd,
  keywordsSuggestionsCmd,
} from "./commands/keywords.ts";
export {
  serpGroup,
  serpGoogleImagesCmd,
  serpGoogleMapsCmd,
  serpGoogleNewsCmd,
  serpGoogleOrganicCmd,
  serpYoutubeOrganicCmd,
} from "./commands/serp.ts";
export {
  backlinksAnchorsCmd,
  backlinksCompetitorsCmd,
  backlinksGroup,
  backlinksListCmd,
  backlinksRanksCmd,
  backlinksReferringDomainsCmd,
  backlinksSummaryCmd,
} from "./commands/backlinks.ts";
export {
  labsBulkDifficultyCmd,
  labsCompetitorsCmd,
  labsGroup,
  labsHistoricalCmd,
  labsIntentCmd,
  labsIntersectionCmd,
  labsKeywordOverviewCmd,
  labsOverviewCmd,
  labsRelatedCmd,
  labsTopSearchesCmd,
} from "./commands/labs.ts";
export {
  aiAskCmd,
  aiGroup,
  aiMentionsCmd,
  aiMetricsCmd,
  aiSearchVolumeCmd,
  aiTopDomainsCmd,
  aiTopPagesCmd,
} from "./commands/ai.ts";
export {
  trendsDemographyCmd,
  trendsExploreCmd,
  trendsGroup,
  trendsSubregionCmd,
} from "./commands/trends.ts";
export { languagesCmd, locationsCmd, userCmd } from "./commands/meta.ts";
export { loginCmd, whoamiCmd } from "./commands/login.ts";
export { rawCmd } from "./commands/raw.ts";
export { endpointsGroup, endpointsListCmd, endpointsShowCmd, endpointsTagsCmd } from "./commands/endpoints.ts";
