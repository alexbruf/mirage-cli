import type {
  PostListing,
  Listing,
  Subreddit,
  User,
  ThreadResponse,
  Post,
  Comment,
} from "./reddit-types.ts";

export type SortListing = "hot" | "new" | "rising" | "top" | "controversial";
export type TimeFilter = "hour" | "day" | "week" | "month" | "year" | "all";
export type CommentSort = "confidence" | "top" | "new" | "controversial" | "old" | "qa";
export type SearchSort = "relevance" | "new" | "hot" | "top" | "comments";
export type SearchType = "link" | "sr" | "user";

export interface ListingOpts {
  limit?: number;
  after?: string;
  before?: string;
  t?: TimeFilter;
}

export interface SearchOpts {
  sub?: string;
  sort?: SearchSort;
  t?: TimeFilter;
  type?: SearchType;
  limit?: number;
  after?: string;
  restrictSr?: boolean;
}

type QueryParams = Record<string, string | number | boolean | undefined>;

export interface ApiClientOpts {
  host: string;
  token: string;
  kind?: "oauth" | "api_key";
  onRefresh?: () => Promise<string | null>;
}

function qs(params: QueryParams): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

export interface JobState {
  id: string;
  status: "pending" | "running" | "complete" | "failed";
  total: number;
  done: number;
  billed: number;
  results: Array<
    { ok: true; data: unknown } | { ok: false; error: string; status?: number } | null
  >;
  error?: string | null;
}

interface JobSubmitted {
  job_id: string;
  status: string;
  total: number;
  poll: string;
}

async function rawFetch(opts: ApiClientOpts, path: string, init?: RequestInit): Promise<Response> {
  const base = opts.host.replace(/\/$/, "");
  const url = path.startsWith("/api/") ? `${base}${path}` : `${base}/api/v1${path}`;
  const doFetch = (tok: string) =>
    fetch(url, {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${tok}` },
    });
  let res = await doFetch(opts.token);
  if (res.status === 401 && opts.kind === "oauth" && opts.onRefresh) {
    const next = await opts.onRefresh().catch(() => null);
    if (next) {
      opts.token = next;
      res = await doFetch(next);
    }
  }
  return res;
}

async function pollJob(opts: ApiClientOpts, submitted: JobSubmitted): Promise<JobState> {
  const deadline = Date.now() + 5 * 60 * 1000;
  let delay = 500;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.3, 2500);
    const res = await rawFetch(opts, submitted.poll);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Job poll ${res.status}: ${text.slice(0, 300)}`);
    }
    const state = (await res.json()) as JobState;
    if (state.status === "complete" || state.status === "failed") return state;
  }
  throw new Error("Job polling timed out after 5 minutes");
}

async function call<T>(opts: ApiClientOpts, path: string, unwrapSingleJob = false): Promise<T> {
  const res = await rawFetch(opts, path);
  if (res.status === 202) {
    const submitted = (await res.json()) as JobSubmitted;
    const state = await pollJob(opts, submitted);
    if (state.status === "failed") {
      throw new Error(`Job failed: ${state.error ?? "unknown"}`);
    }
    if (unwrapSingleJob) {
      const first = state.results[0];
      if (!first) throw new Error("Job completed with no result");
      if (!first.ok) throw new Error(`API ${first.status ?? ""}: ${first.error}`);
      return first.data as T;
    }
    return state as unknown as T;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export async function listing(
  c: ApiClientOpts,
  sub: string,
  sort: SortListing,
  opts: ListingOpts = {},
): Promise<PostListing> {
  const path = sub ? `/r/${encodeURIComponent(sub)}/${sort}` : `/frontpage/${sort}`;
  return call<PostListing>(c, `${path}${qs({ ...opts } as QueryParams)}`);
}

export async function thread(
  c: ApiClientOpts,
  id: string,
  opts: {
    sort?: CommentSort;
    depth?: number;
    limit?: number;
    sub?: string;
    expandMore?: boolean;
  } = {},
): Promise<ThreadResponse> {
  return call<ThreadResponse>(
    c,
    `/post/${encodeURIComponent(id)}${qs({
      sort: opts.sort,
      depth: opts.depth,
      limit: opts.limit,
      sub: opts.sub,
      expand_more: opts.expandMore ? 1 : undefined,
    })}`,
    !!opts.expandMore,
  );
}

export async function search(
  c: ApiClientOpts,
  q: string,
  opts: SearchOpts = {},
): Promise<PostListing> {
  return call<PostListing>(
    c,
    `/search${qs({
      q,
      sub: opts.sub,
      sort: opts.sort,
      t: opts.t,
      type: opts.type,
      limit: opts.limit,
      after: opts.after,
      restrict_sr: opts.restrictSr ? 1 : undefined,
    })}`,
  );
}

export async function aboutSub(c: ApiClientOpts, sub: string): Promise<Subreddit> {
  return call(c, `/about/sub/${encodeURIComponent(sub)}`);
}
export async function aboutUser(c: ApiClientOpts, name: string): Promise<User> {
  return call(c, `/about/user/${encodeURIComponent(name)}`);
}
export async function userPosts(
  c: ApiClientOpts,
  name: string,
  kind: "submitted" | "comments",
  opts: ListingOpts & { sort?: string } = {},
): Promise<Listing<Post | Comment>> {
  return call(c, `/user/${encodeURIComponent(name)}/${kind}${qs({ ...opts } as QueryParams)}`);
}
export async function subreddits(
  c: ApiClientOpts,
  kind: "popular" | "new" | "default" | "premium",
  opts: ListingOpts = {},
): Promise<Listing<Subreddit>> {
  return call(c, `/subs/${kind}${qs({ ...opts } as QueryParams)}`);
}
export async function searchSubs(
  c: ApiClientOpts,
  q: string,
  opts: ListingOpts = {},
): Promise<Listing<Subreddit>> {
  return call(c, `/subs/search${qs({ q, ...opts } as QueryParams)}`);
}

export async function me(c: ApiClientOpts): Promise<{ user_id: string; credits: number }> {
  return call(c, "/me");
}

export interface BulkItem {
  op: string;
  [k: string]: unknown;
}
export async function bulk(
  c: ApiClientOpts,
  items: BulkItem[],
): Promise<JobState | { results: unknown[] }> {
  const res = await rawFetch(c, "/bulk", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (res.status === 202) {
    const submitted = (await res.json()) as JobSubmitted;
    return pollJob(c, submitted);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as { results: unknown[] };
}

export async function job(c: ApiClientOpts, id: string): Promise<JobState> {
  return call(c, `/jobs/${encodeURIComponent(id)}`);
}
