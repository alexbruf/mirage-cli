/**
 * Pure async API functions for the "keywords" group. The CLI commands and
 * any programmatic caller delegate to these.
 */
import { call, type DfsResponse } from "../lib/client.ts";

export interface LocLang {
  locationName?: string;
  locationCode?: number;
  languageName?: string;
  languageCode?: string;
}

function locLangPayload(loc: LocLang): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (loc.locationCode !== undefined) body.location_code = loc.locationCode;
  else body.location_name = loc.locationName ?? "United States";
  if (loc.languageCode !== undefined) body.language_code = loc.languageCode;
  else body.language_name = loc.languageName ?? "English";
  return body;
}

export async function keywordsSearchVolume(
  opts: LocLang & { keywords: string[]; includeSerpInfo?: boolean },
): Promise<DfsResponse> {
  return call("keywords_data/google_ads/search_volume/live", {
    ...locLangPayload(opts),
    keywords: opts.keywords,
    include_serp_info: opts.includeSerpInfo ?? false,
  });
}

export async function keywordsIdeas(
  opts: LocLang & { keywords: string[]; limit?: number },
): Promise<DfsResponse> {
  return call("dataforseo_labs/google/keyword_ideas/live", {
    ...locLangPayload(opts),
    keywords: opts.keywords,
    limit: opts.limit ?? 100,
  });
}

export async function keywordsSuggestions(
  opts: LocLang & { keyword: string; limit?: number },
): Promise<DfsResponse> {
  return call("dataforseo_labs/google/keyword_suggestions/live", {
    ...locLangPayload(opts),
    keyword: opts.keyword,
    limit: opts.limit ?? 100,
  });
}

export async function keywordsRanked(
  opts: LocLang & { target: string; limit?: number },
): Promise<DfsResponse> {
  return call("dataforseo_labs/google/ranked_keywords/live", {
    ...locLangPayload(opts),
    target: opts.target,
    limit: opts.limit ?? 100,
  });
}
