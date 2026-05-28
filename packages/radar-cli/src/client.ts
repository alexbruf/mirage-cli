import { type Session, saveSession } from "./config.ts";
import { refreshAccessToken } from "./oauth.ts";

export interface RequestOptions {
  method?: string;
  body?: BodyInit;
  headers?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
}

/** Shape returned by the org-scoped V1 list endpoints. */
export interface ListResponse<T = Record<string, unknown>> {
  rows: T[];
  total: number;
  page: number;
  limit: number;
}

/** Shape returned by the org-scoped V1 detail / mutation endpoints. */
export interface DetailResponse<T = Record<string, unknown>> {
  row: T;
}

/** Query params common to the V1 list endpoints. */
export interface ListParams {
  search?: string;
  status?: string;
  provider?: string;
  category?: string;
  type?: string;
  projectId?: string;
  queryId?: string;
  page?: string | number;
  limit?: string | number;
  sortBy?: string;
  sortDir?: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(`[${status}] ${message}`);
    this.name = "ApiError";
  }
}

export class ApiClient {
  constructor(private session: Session) {}

  async request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
    const res = await this.fetch(path, opts);
    if (!res.ok) throw await errorFromResponse(res);
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) return (await res.json()) as T;
    return (await res.text()) as unknown as T;
  }

  async requestRaw(path: string, opts: RequestOptions = {}): Promise<Response> {
    const res = await this.fetch(path, opts);
    if (!res.ok) throw await errorFromResponse(res);
    return res;
  }

  /** GET an org-scoped V1 list: `/api/v1/<entity>` → `{ rows, total, page, limit }`. */
  async list<T = Record<string, unknown>>(
    entity: string,
    params: ListParams = {},
  ): Promise<ListResponse<T>> {
    return this.request<ListResponse<T>>(`/v1/${entity}`, { query: toQuery(params) });
  }

  /** GET an org-scoped V1 detail row: `/api/v1/<entity>/<id>` → `{ row }`. */
  async get<T = Record<string, unknown>>(entity: string, id: string): Promise<T> {
    const data = await this.request<DetailResponse<T>>(`/v1/${entity}/${encodeURIComponent(id)}`);
    return data.row;
  }

  /** PATCH an org-scoped V1 row: `/api/v1/<entity>/<id>` → `{ row }`. */
  async patch<T = Record<string, unknown>>(
    entity: string,
    id: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const data = await this.request<DetailResponse<T>>(`/v1/${entity}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return data.row;
  }

  private async fetch(path: string, opts: RequestOptions): Promise<Response> {
    await this.refreshIfNeeded();
    const url = this.buildUrl(path, opts.query);
    const token = this.session.apiKey ?? this.session.accessToken;
    if (!token) {
      throw new ApiError(401, "No credentials in session. Run: radar login");
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...(this.session.activeOrgId ? { "X-Active-Org-Id": this.session.activeOrgId } : {}),
      ...opts.headers,
    };
    return fetch(url, {
      method: opts.method ?? "GET",
      body: opts.body,
      headers,
    });
  }

  private async refreshIfNeeded(): Promise<void> {
    const s = this.session;
    if (s.apiKey) return;
    if (!s.accessToken || !s.refreshToken || !s.expiresAt || !s.tokenEndpoint || !s.clientId) {
      return;
    }
    if (s.expiresAt - Date.now() > 60_000) return;
    const refreshed = await refreshAccessToken({
      refreshToken: s.refreshToken,
      clientId: s.clientId,
      tokenEndpoint: s.tokenEndpoint,
    });
    s.accessToken = refreshed.accessToken;
    s.refreshToken = refreshed.refreshToken;
    s.expiresAt = refreshed.expiresAt;
    s.savedAt = new Date().toISOString();
    saveSession(s);
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const base = this.session.baseUrl.replace(/\/$/, "");
    const suffix = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${base}/api${suffix}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }
}

/**
 * Map V1 list params to a query record. Keys are passed through verbatim
 * (the V1 API reads camelCase: `projectId`, `queryId`, `sortBy`, `sortDir`).
 * Undefined values are dropped by the URL builder.
 */
function toQuery(params: ListParams): Record<string, string | number | undefined> {
  return params as Record<string, string | number | undefined>;
}

async function errorFromResponse(res: Response): Promise<ApiError> {
  const text = await res.text();
  let message: string;
  try {
    const json = JSON.parse(text);
    message = (json as { error?: string }).error ?? text;
  } catch {
    message = text || res.statusText;
  }
  return new ApiError(res.status, message);
}
