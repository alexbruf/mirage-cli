import { getDefaultBaseUrl } from "./config.ts";

/**
 * Read-only CallRail v3 client. The only HTTP verb this class can emit is
 * GET — the write surface deliberately does not exist, so a wrapped LLM
 * driver cannot mutate CallRail data even by constructing odd commands.
 *
 * Docs: https://apidocs.callrail.com/
 */

export type Query = Record<string, string | number | boolean | string[] | undefined>;

/** Offset-pagination envelope returned by the v3 list endpoints. */
export interface ListEnvelope {
  page: number;
  per_page: number;
  total_pages: number;
  total_records: number;
  [collection: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public hint?: string,
  ) {
    super(`[${status}] ${message}`);
    this.name = "ApiError";
  }
}

export interface ClientOptions {
  apiKey: string;
  accountId?: string;
  baseUrl?: string;
}

export class CallRailClient {
  readonly accountId: string | undefined;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: ClientOptions) {
    this.apiKey = opts.apiKey;
    this.accountId = opts.accountId;
    this.baseUrl = (opts.baseUrl ?? getDefaultBaseUrl()).replace(/\/$/, "");
  }

  /** GET an absolute v3 path (e.g. `/a.json`, `/a/ACC.../calls.json`). */
  async get<T = unknown>(path: string, query: Query = {}): Promise<T> {
    const url = this.buildUrl(path, query);
    let res = await this.fetch(url);
    // 429: single retry honoring a short Retry-After; otherwise surface it.
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? Number.NaN);
      if (Number.isFinite(retryAfter) && retryAfter <= 15) {
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        res = await this.fetch(url);
      }
    }
    if (!res.ok) throw await errorFromResponse(res);
    return (await res.json()) as T;
  }

  /** GET an account-scoped path: `/a/{accountId}/<resource>.json`. */
  async accountGet<T = unknown>(resource: string, query: Query = {}): Promise<T> {
    if (!this.accountId) {
      throw new ApiError(
        400,
        "No account resolved",
        "pass --account <id>, set CALLRAIL_ACCOUNT_ID, or run `callrail accounts use <id>`",
      );
    }
    return this.get<T>(`/a/${encodeURIComponent(this.accountId)}/${resource}`, query);
  }

  private fetch(url: string): Promise<Response> {
    return fetch(url, {
      // GET only, by design. No method parameter exists on this client.
      method: "GET",
      headers: {
        Authorization: `Token token="${this.apiKey}"`,
        Accept: "application/json",
      },
    });
  }

  private buildUrl(path: string, query: Query): string {
    const suffix = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${suffix}`);
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(`${k}[]`, item);
      } else {
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }
}

async function errorFromResponse(res: Response): Promise<ApiError> {
  const text = await res.text();
  let message: string;
  try {
    const json = JSON.parse(text) as { error?: string; message?: string };
    message = json.error ?? json.message ?? text;
  } catch {
    message = text || res.statusText;
  }
  let hint: string | undefined;
  if (res.status === 401) hint = "check the API key for this profile";
  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after");
    hint = retryAfter
      ? `rate limited — retry after ${retryAfter}s`
      : "rate limited (1,000 req/hour, 10,000/day)";
  }
  return new ApiError(res.status, message, hint);
}
