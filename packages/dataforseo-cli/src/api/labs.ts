import { call, type DfsResponse } from "../lib/client.ts";
import type { LocLang } from "./keywords.ts";

function locLangPayload(loc: LocLang): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (loc.locationCode !== undefined) body.location_code = loc.locationCode;
  else body.location_name = loc.locationName ?? "United States";
  if (loc.languageCode !== undefined) body.language_code = loc.languageCode;
  else body.language_name = loc.languageName ?? "English";
  return body;
}

export async function labsCompetitors(opts: LocLang & { target: string; limit?: number }): Promise<DfsResponse> {
  return call("dataforseo_labs/google/competitors_domain/live", {
    ...locLangPayload(opts),
    target: opts.target,
    limit: opts.limit ?? 100,
  });
}

export async function labsIntersection(
  opts: LocLang & { target1: string; target2: string; limit?: number },
): Promise<DfsResponse> {
  return call("dataforseo_labs/google/domain_intersection/live", {
    ...locLangPayload(opts),
    target1: opts.target1,
    target2: opts.target2,
    limit: opts.limit ?? 100,
  });
}

export async function labsOverview(opts: LocLang & { target: string }): Promise<DfsResponse> {
  return call("dataforseo_labs/google/domain_rank_overview/live", {
    ...locLangPayload(opts),
    target: opts.target,
  });
}

export async function labsRelated(opts: LocLang & { keyword: string; limit?: number }): Promise<DfsResponse> {
  return call("dataforseo_labs/google/related_keywords/live", {
    ...locLangPayload(opts),
    keyword: opts.keyword,
    limit: opts.limit ?? 100,
  });
}

/** Full keyword overview: KD + volume + intent + SERP + backlink info in one call. */
export async function labsKeywordOverview(
  opts: LocLang & { keywords: string[]; includeSerpInfo?: boolean; includeClickstream?: boolean },
): Promise<DfsResponse> {
  return call("dataforseo_labs/google/keyword_overview/live", {
    ...locLangPayload(opts),
    keywords: opts.keywords,
    include_serp_info: opts.includeSerpInfo ?? false,
    include_clickstream_data: opts.includeClickstream ?? false,
  });
}

/** Bulk keyword difficulty (KD) for up to 1000 keywords in one call. */
export async function labsBulkDifficulty(
  opts: LocLang & { keywords: string[] },
): Promise<DfsResponse> {
  return call("dataforseo_labs/google/bulk_keyword_difficulty/live", {
    ...locLangPayload(opts),
    keywords: opts.keywords,
  });
}

/** Classify search intent (informational/navigational/commercial/transactional) for keywords. */
export async function labsIntent(opts: LocLang & { keywords: string[] }): Promise<DfsResponse> {
  return call("dataforseo_labs/google/search_intent/live", {
    ...locLangPayload(opts),
    keywords: opts.keywords,
  });
}

/** Currently-trending top searches in a location. */
export async function labsTopSearches(opts: LocLang & { limit?: number }): Promise<DfsResponse> {
  return call("dataforseo_labs/google/top_searches/live", {
    ...locLangPayload(opts),
    limit: opts.limit ?? 100,
  });
}

/** Historical rank overview for a domain (month-by-month organic position counts). */
export async function labsHistorical(opts: LocLang & { target: string }): Promise<DfsResponse> {
  return call("dataforseo_labs/google/historical_rank_overview/live", {
    ...locLangPayload(opts),
    target: opts.target,
  });
}
