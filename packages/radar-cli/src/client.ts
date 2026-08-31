import { type Session, saveSession } from "./config.ts";
import { refreshAccessToken } from "./oauth.ts";

export interface RequestOptions {
  method?: string;
  body?: BodyInit;
  headers?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

export interface SseRequestOptions {
  /** Request timeout in milliseconds. Defaults to three minutes. */
  timeoutMs?: number;
  /** Status messages are appended here and never printed while streaming. */
  statusMessages?: string[];
}

interface SseEvent {
  type?: string;
  data?: unknown;
  message?: string;
}

export const DEFAULT_SSE_TIMEOUT_MS = 180_000;

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

  /** POST JSON to a dashboard API route and return its response body as-is. */
  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /** POST JSON and buffer an authenticated SSE response until its `done` event. */
  async postSse<T = unknown>(
    path: string,
    body: unknown,
    opts: SseRequestOptions = {},
  ): Promise<T> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_SSE_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error(
        `SSE timeout must be a positive number of milliseconds (received ${timeoutMs})`,
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await this.requestRaw(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.body) throw new Error("SSE response had no body");
      return await parseSseStream<T>(res.body, opts.statusMessages);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`SSE request timed out after ${timeoutMs}ms`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
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
      signal: opts.signal,
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
 * Incrementally parse Radar's single-line `data: <json>` SSE protocol.
 * Nothing is emitted while reading: callers may print collected statuses only
 * after the stream has completed, which keeps buffered command runners safe.
 */
export async function parseSseStream<T>(
  stream: ReadableStream<Uint8Array>,
  statusMessages: string[] = [],
): Promise<T> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamEnded = false;
  let receivedDone = false;
  let receivedResult = false;
  let result: T | undefined;

  const parseEvent = (block: string): void => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;

    let event: SseEvent;
    try {
      event = JSON.parse(data) as SseEvent;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid JSON in SSE event: ${message}`);
    }

    switch (event.type) {
      case "status":
        if (typeof event.message === "string") statusMessages.push(event.message);
        break;
      case "result":
        result = event.data as T;
        receivedResult = true;
        break;
      case "error":
        throw new ApiError(500, event.message ?? "Onboarding stream failed");
      case "done":
        receivedDone = true;
        break;
      default:
        // `partial` and unknown forward-compatible event types do not affect
        // the command's final JSON result.
        break;
    }
  };

  const consumeBufferedEvents = (): void => {
    for (;;) {
      const separator = buffer.match(/\r?\n\r?\n/);
      if (!separator || separator.index === undefined) return;
      const block = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator[0].length);
      parseEvent(block);
      if (receivedDone) return;
    }
  };

  try {
    while (!receivedDone) {
      const chunk = await reader.read();
      if (chunk.done) {
        streamEnded = true;
        buffer += decoder.decode();
        if (buffer.trim()) parseEvent(buffer);
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      consumeBufferedEvents();
    }
  } finally {
    if (!streamEnded) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  if (!receivedDone && !receivedResult) {
    throw new Error("SSE stream ended without a result or done event");
  }
  if (!receivedDone) throw new Error("SSE stream ended without a done event");
  if (!receivedResult) throw new Error("SSE stream ended without a result event");
  return result as T;
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
