import { getDefaultBaseUrl } from "./config.ts";

/**
 * Read-only HubSpot client. The only HTTP verbs this class can emit are GET
 * and the read-only search POST (`/search` endpoints take a POST body but
 * mutate nothing). The create/update/delete surface deliberately does not
 * exist, so a wrapped LLM driver cannot mutate HubSpot data even by
 * constructing odd commands — see [[cli-readwrite-boundary]].
 *
 * Every HubSpot credential type (private app access token, OAuth access
 * token, or a token minted from a personal access key) is the same
 * `Authorization: Bearer <token>` at the API layer, so the client only ever
 * needs a bearer. Token acquisition lives in config.ts.
 *
 * Docs: https://developers.hubspot.com/docs/api/overview
 */

export type Query = Record<string, string | number | boolean | string[] | undefined>;

/** Cursor-pagination envelope returned by the v3 collection endpoints. */
export interface ListEnvelope {
  results: unknown[];
  paging?: { next?: { after?: string; link?: string } };
  total?: number;
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

/** Resolves the bearer token for one request (may exchange/refresh lazily). */
export type TokenProvider = () => Promise<string>;

export interface ClientOptions {
  /** Static bearer token, or a provider that yields one (private app token, OAuth token, or PAK-exchanged token). */
  token: string | TokenProvider;
  baseUrl?: string;
}

export class HubSpotClient {
  private readonly token: TokenProvider;
  private readonly baseUrl: string;

  constructor(opts: ClientOptions) {
    this.token = typeof opts.token === "string" ? async () => opts.token as string : opts.token;
    this.baseUrl = (opts.baseUrl ?? getDefaultBaseUrl()).replace(/\/$/, "");
  }

  /** GET an absolute v3 path (e.g. `/crm/v3/objects/contacts`). */
  async get<T = unknown>(path: string, query: Query = {}): Promise<T> {
    return this.request<T>("GET", path, query);
  }

  /**
   * POST a read-only `/search` request. Allowed precisely because HubSpot's
   * object search is a non-mutating query that happens to use POST for its
   * JSON body. The path MUST end in `/search` — enforced so this method can't
   * become a generic write primitive.
   */
  async search<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
    if (!path.replace(/\/$/, "").endsWith("/search")) {
      throw new ApiError(400, `Refusing non-search POST to ${path}`, "this client is read-only");
    }
    return this.request<T>("POST", path, {}, body);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    query: Query,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = this.buildUrl(path, query);
    let res = await this.fetch(method, url, body);
    // 429: single retry honoring a short Retry-After; otherwise surface it.
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? Number.NaN);
      if (Number.isFinite(retryAfter) && retryAfter <= 15) {
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        res = await this.fetch(method, url, body);
      }
    }
    if (!res.ok) throw await errorFromResponse(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private async fetch(
    method: "GET" | "POST",
    url: string,
    body?: Record<string, unknown>,
  ): Promise<Response> {
    const token = await this.token();
    return fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  private buildUrl(path: string, query: Query): string {
    const suffix = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${suffix}`);
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(k, item);
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
    const json = JSON.parse(text) as { message?: string; errors?: { message?: string }[] };
    message = json.message ?? json.errors?.[0]?.message ?? text;
  } catch {
    message = text || res.statusText;
  }
  let hint: string | undefined;
  if (res.status === 401)
    hint = "token invalid/expired — check the private app token or personal access key";
  if (res.status === 403)
    hint = "missing scope — grant the read scope to the private app (or PAK) for this object";
  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after");
    hint = retryAfter ? `rate limited — retry after ${retryAfter}s` : "rate limited";
  }
  return new ApiError(res.status, message, hint);
}
