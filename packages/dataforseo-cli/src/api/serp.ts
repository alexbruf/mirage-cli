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

export interface SerpOpts extends LocLang {
  keyword: string;
  device?: "desktop" | "mobile";
  depth?: number;
}

export async function serpGoogleOrganic(opts: SerpOpts & { advanced?: boolean }): Promise<DfsResponse> {
  const path = opts.advanced ? "serp/google/organic/live/advanced" : "serp/google/organic/live/regular";
  return call(path, {
    ...locLangPayload(opts),
    keyword: opts.keyword,
    device: opts.device ?? "desktop",
    depth: opts.depth ?? 100,
  });
}

export async function serpGoogleMaps(opts: SerpOpts): Promise<DfsResponse> {
  return call("serp/google/maps/live/advanced", {
    ...locLangPayload(opts),
    keyword: opts.keyword,
    device: opts.device ?? "desktop",
    depth: opts.depth ?? 100,
  });
}

export async function serpYoutubeOrganic(opts: SerpOpts): Promise<DfsResponse> {
  return call("serp/youtube/organic/live/advanced", {
    ...locLangPayload(opts),
    keyword: opts.keyword,
    depth: opts.depth ?? 100,
  });
}

export async function serpGoogleNews(opts: SerpOpts): Promise<DfsResponse> {
  return call("serp/google/news/live/advanced", {
    ...locLangPayload(opts),
    keyword: opts.keyword,
    device: opts.device ?? "desktop",
    depth: opts.depth ?? 100,
  });
}

export async function serpGoogleImages(opts: SerpOpts): Promise<DfsResponse> {
  return call("serp/google/images/live/advanced", {
    ...locLangPayload(opts),
    keyword: opts.keyword,
    device: opts.device ?? "desktop",
    depth: opts.depth ?? 100,
  });
}
