/**
 * Thin fetch helpers for the GA4 REST API. Replaces what `@google-analytics/data`
 * and `@google-analytics/admin` did under the hood — pure HTTPS calls, no gRPC,
 * no protobuf.js, no google-auth-library, no `google-gax`. Workerd-compatible.
 *
 * Endpoints:
 *   ADMIN_BETA  = https://analyticsadmin.googleapis.com/v1beta
 *   ADMIN_ALPHA = https://analyticsadmin.googleapis.com/v1alpha   (annotations, accessReport)
 *   DATA_BETA   = https://analyticsdata.googleapis.com/v1beta
 */

import { authHeaders, requireAccessToken } from "./auth.ts";

export const ADMIN_BETA = "https://analyticsadmin.googleapis.com/v1beta";
export const ADMIN_ALPHA = "https://analyticsadmin.googleapis.com/v1alpha";
export const DATA_BETA = "https://analyticsdata.googleapis.com/v1beta";

export interface RequestOpts {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  timeout?: number;
}

export class GA4ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
    this.name = "GA4ApiError";
  }
}

/** Authenticated single request (GET or POST). Returns parsed JSON, throws GA4ApiError on non-2xx. */
export async function gaRequest<T = unknown>(url: string, opts: RequestOpts = {}): Promise<T> {
  const token = await requireAccessToken();
  const { method = "GET", body, headers = {}, query, timeout = 30_000 } = opts;
  const finalUrl = query ? appendQuery(url, query) : url;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(finalUrl, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...authHeaders(token),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let message = `HTTP ${res.status}`;
      let details: unknown;
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } };
        if (parsed.error?.message) message = parsed.error.message;
        details = parsed.error;
      } catch {
        if (text) message = text.slice(0, 500);
      }
      throw new GA4ApiError(res.status, message, details);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function appendQuery(
  url: string,
  query: Record<string, string | number | boolean | undefined>,
): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

/**
 * Iterate every page of a paginated GET endpoint and return the flat array.
 * Matches the shape of what `collectAsync(client.listFooAsync())` used to return.
 */
export async function listAll<T>(
  url: string,
  itemsKey: string,
  query: Record<string, string | number | boolean | undefined> = {},
  pageSize = 200,
): Promise<T[]> {
  const items: T[] = [];
  let pageToken: string | undefined;
  do {
    const res = await gaRequest<Record<string, unknown>>(url, {
      query: { ...query, pageSize, ...(pageToken ? { pageToken } : {}) },
    });
    const page = res[itemsKey];
    if (Array.isArray(page)) items.push(...(page as T[]));
    pageToken = typeof res.nextPageToken === "string" ? res.nextPageToken : undefined;
  } while (pageToken);
  return items;
}

/**
 * Same as `listAll`, but the endpoint is a POST (e.g. `searchChangeHistoryEvents`)
 * and the body carries the filter. Adds `pageToken` to the body on subsequent pages.
 */
export async function listAllPost<T>(
  url: string,
  itemsKey: string,
  body: Record<string, unknown>,
  pageSize = 200,
): Promise<T[]> {
  const items: T[] = [];
  let pageToken: string | undefined;
  do {
    const reqBody: Record<string, unknown> = {
      ...body,
      pageSize,
      ...(pageToken ? { pageToken } : {}),
    };
    const res = await gaRequest<Record<string, unknown>>(url, {
      method: "POST",
      body: reqBody,
    });
    const page = res[itemsKey];
    if (Array.isArray(page)) items.push(...(page as T[]));
    pageToken = typeof res.nextPageToken === "string" ? res.nextPageToken : undefined;
  } while (pageToken);
  return items;
}
