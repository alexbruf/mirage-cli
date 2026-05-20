import { call, type DfsResponse } from "../lib/client.ts";
import type { LocLang } from "./keywords.ts";

function locPayload(loc: LocLang): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (loc.locationCode !== undefined) body.location_code = loc.locationCode;
  else body.location_name = loc.locationName ?? "United States";
  // google trends is location-only; some dataforseo_trends endpoints accept language too
  if (loc.languageCode !== undefined) body.language_code = loc.languageCode;
  return body;
}

export type TrendsType = "web" | "news" | "youtube" | "images" | "shopping";

/** Google Trends "Explore" — popularity time series. */
export async function trendsExplore(
  opts: LocLang & { keywords: string[]; type?: TrendsType; dateFrom?: string; dateTo?: string },
): Promise<DfsResponse> {
  return call("keywords_data/google_trends/explore/live", {
    ...locPayload(opts),
    keywords: opts.keywords,
    type: opts.type ?? "web",
    date_from: opts.dateFrom,
    date_to: opts.dateTo,
  });
}

/** DataForSEO Trends demography — age/gender breakdown for keywords. */
export async function trendsDemography(opts: LocLang & { keywords: string[] }): Promise<DfsResponse> {
  return call("keywords_data/dataforseo_trends/demography/live", {
    ...locPayload(opts),
    keywords: opts.keywords,
  });
}

/** DataForSEO Trends sub-region interest — regional popularity heatmap. */
export async function trendsSubregion(opts: LocLang & { keywords: string[] }): Promise<DfsResponse> {
  return call("keywords_data/dataforseo_trends/subregion_interests/live", {
    ...locPayload(opts),
    keywords: opts.keywords,
  });
}
