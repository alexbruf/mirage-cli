import { call, type DfsResponse } from "../lib/client.ts";

export async function backlinksSummary(target: string): Promise<DfsResponse> {
  return call("backlinks/summary/live", { target });
}

export async function backlinksList(opts: {
  target: string;
  limit?: number;
  mode?: "as_is" | "one_per_domain" | "one_per_anchor";
}): Promise<DfsResponse> {
  return call("backlinks/backlinks/live", {
    target: opts.target,
    limit: opts.limit ?? 100,
    mode: opts.mode ?? "as_is",
  });
}

export async function backlinksReferringDomains(opts: { target: string; limit?: number }): Promise<DfsResponse> {
  return call("backlinks/referring_domains/live", { target: opts.target, limit: opts.limit ?? 100 });
}

export async function backlinksAnchors(opts: { target: string; limit?: number }): Promise<DfsResponse> {
  return call("backlinks/anchors/live", { target: opts.target, limit: opts.limit ?? 100 });
}

export async function backlinksCompetitors(opts: { target: string; limit?: number }): Promise<DfsResponse> {
  return call("backlinks/competitors/live", { target: opts.target, limit: opts.limit ?? 100 });
}

export async function backlinksRanks(targets: string[]): Promise<DfsResponse> {
  return call("backlinks/bulk_ranks/live", { targets });
}
