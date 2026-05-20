import { endpointCommand } from "../command-builder.ts";
import { group } from "../framework/runtime.ts";

// All commands accept the keyword(s) as the first positional arg.
// Pass a comma-separated list for multi-keyword queries.
const K = "keywords" as const;

export const keywordsOverviewCmd = endpointCommand({
  path: "/keywords-explorer/overview",
  name: "overview",
  defaultSelect: "keyword,volume,difficulty,cpc,clicks,global_volume",
  rowsKey: "keywords",
  positional: K,
});

export const keywordsMatchingTermsCmd = endpointCommand({
  path: "/keywords-explorer/matching-terms",
  name: "matching-terms",
  defaultSelect: "keyword,volume,difficulty,cpc,parent_topic",
  rowsKey: "keywords",
  positional: K,
});

export const keywordsRelatedTermsCmd = endpointCommand({
  path: "/keywords-explorer/related-terms",
  name: "related-terms",
  defaultSelect: "keyword,volume,difficulty,cpc",
  rowsKey: "keywords",
  positional: K,
});

export const keywordsSearchSuggestionsCmd = endpointCommand({
  path: "/keywords-explorer/search-suggestions",
  name: "search-suggestions",
  defaultSelect: "keyword,volume",
  rowsKey: "keywords",
  positional: K,
});

export const keywordsVolumeByCountryCmd = endpointCommand({
  path: "/keywords-explorer/volume-by-country",
  name: "volume-by-country",
  rowsKey: "countries",
  positional: K,
});

export const keywordsVolumeHistoryCmd = endpointCommand({
  path: "/keywords-explorer/volume-history",
  name: "volume-history",
  rowsKey: "metrics",
  positional: K,
});

export const keywordsGroup = group({
  name: "keywords",
  description: "Keywords Explorer — volume, KD, ideas, SERP, history.",
  commands: [
    keywordsOverviewCmd,
    keywordsMatchingTermsCmd,
    keywordsRelatedTermsCmd,
    keywordsSearchSuggestionsCmd,
    keywordsVolumeByCountryCmd,
    keywordsVolumeHistoryCmd,
  ],
});
