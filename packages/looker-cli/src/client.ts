/**
 * Typed, fetch-only client for the looker.so rank tracker.
 *
 * looker.so exposes the same backend over two surfaces with the same bearer
 * key: REST at /api/v1 (the documented, stable paths) and MCP at /api/mcp
 * (JSON-RPC 2.0, stateless, no session handshake). REST is used wherever an
 * endpoint exists; MCP covers the tools REST does not have (competitor gap,
 * Search Console, the summary helpers, ranked-keyword discovery, wait_for).
 *
 * API reference: the in-app "API docs" page at https://looker.so (signed in).
 */

import { reportCost } from "@mirage-cli/core";

export const DEFAULT_BASE_URL = "https://looker.so";

export type ApiErrorKind =
  | "authentication"
  | "plan_required"
  | "forbidden"
  | "rate_limited"
  | "bad_request"
  | "not_found"
  | "server"
  | "tool_error"
  | "api";

export class LookerApiError extends Error {
  override readonly name = "LookerApiError";

  constructor(
    public readonly status: number,
    message: string,
    public readonly kind: ApiErrorKind,
    public readonly code?: string,
    public readonly hint?: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(status ? `[${status}] ${message}` : message);
  }
}

export interface LookerClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Injectable for tests and runtimes that provide their own fetch. */
  fetch?: typeof globalThis.fetch;
}

export type Query = Record<string, string | number | boolean | undefined>;

export class LookerClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private rpcId = 0;

  constructor(options: LookerClientOptions) {
    const apiKey = options.apiKey.trim();
    if (!apiKey) throw new Error("looker.so API key cannot be empty.");
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch
      ?? ((input, init) => globalThis.fetch(input, init)) as typeof globalThis.fetch;
  }

  get<T = unknown>(path: string, query?: Query): Promise<T> {
    return this.rest<T>("GET", path, undefined, query);
  }

  post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.rest<T>("POST", path, body ?? {});
  }

  patch<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.rest<T>("PATCH", path, body);
  }

  delete<T = unknown>(path: string): Promise<T> {
    return this.rest<T>("DELETE", path);
  }

  /**
   * Call a paid REST endpoint and record its spend. looker.so bills the
   * account's own DataForSEO key; responses that carry `costMicros` report the
   * exact dollar amount, the rest report a call with no stated price.
   */
  async paid<T = unknown>(method: "POST", path: string, body?: unknown): Promise<T> {
    const data = await this.rest<T>(method, path, body ?? {});
    reportCost({ provider: "looker", usd: costUsd(data) });
    return data;
  }

  /** Call an MCP tool; returns the tool's JSON result. */
  async tool<T = unknown>(name: string, args: Record<string, unknown> = {}, opts: { paid?: boolean } = {}): Promise<T> {
    const id = ++this.rpcId;
    const response = await this.fetchImpl(`${this.baseUrl}/api/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: stripUndefined(args) },
      }),
    });
    if (!response.ok) throw await errorFromResponse(response);

    const envelope = await readRpcEnvelope(response);
    if (envelope.error) {
      throw new LookerApiError(0, envelope.error.message ?? "MCP error", "api", String(envelope.error.code ?? ""));
    }
    const result = envelope.result ?? {};
    const text = (result.content ?? [])
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("");
    if (result.isError) {
      throw new LookerApiError(0, text.replace(/^Error:\s*/, "") || `${name} failed`, "tool_error");
    }
    const data = parseMaybeJson(text) as T;
    if (opts.paid) reportCost({ provider: "looker", usd: costUsd(data) });
    return data;
  }

  private async rest<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const response = await this.fetchImpl(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(stripUndefined(body)) } : {}),
    });
    if (!response.ok) throw await errorFromResponse(response);

    const text = await response.text();
    const parsed = parseMaybeJson(text);
    if (parsed && typeof parsed === "object" && "ok" in parsed) {
      const envelope = parsed as { ok: boolean; data?: unknown; error?: string; code?: string };
      if (!envelope.ok) {
        throw new LookerApiError(response.status, envelope.error ?? "looker.so error", "api", envelope.code);
      }
      return envelope.data as T;
    }
    return parsed as T;
  }
}

interface RpcEnvelope {
  result?: { content?: Array<{ type?: string; text?: unknown }>; isError?: boolean };
  error?: { code?: number; message?: string };
}

async function readRpcEnvelope(response: Response): Promise<RpcEnvelope> {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    // Streamable HTTP may answer as SSE; the reply is the last data event.
    const events = text.split(/\r?\n/).filter((line) => line.startsWith("data:"));
    const last = events[events.length - 1];
    if (!last) throw new LookerApiError(response.status, "empty MCP event stream", "api");
    return JSON.parse(last.slice(5).trim()) as RpcEnvelope;
  }
  try {
    return JSON.parse(text) as RpcEnvelope;
  } catch {
    throw new LookerApiError(response.status, "MCP returned a non-JSON response", "api");
  }
}

function costUsd(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const micros = record.costMicros
    ?? (record.report && typeof record.report === "object"
      ? (record.report as Record<string, unknown>).totalCostMicros
        ?? (record.report as Record<string, unknown>).costMicros
      : undefined);
  return typeof micros === "number" && Number.isFinite(micros) ? micros / 1_000_000 : null;
}

function parseMaybeJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function stripUndefined(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

async function errorFromResponse(response: Response): Promise<LookerApiError> {
  const text = await response.text();
  const body = parseMaybeJson(text);
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const message = (typeof record.error === "string" && record.error)
    || (typeof body === "string" && body)
    || response.statusText
    || "looker.so API error";
  const code = typeof record.code === "string" ? record.code : undefined;
  const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));

  let kind: ApiErrorKind = "api";
  let hint: string | undefined;
  if (response.status === 401) {
    kind = "authentication";
    hint = "check LOOKER_API_KEY (keys look like lk_live_…)";
  } else if (response.status === 402) {
    kind = "plan_required";
    hint = "the looker.so org has no active plan";
  } else if (response.status === 403) {
    kind = "forbidden";
    hint = "this operation needs an owner/admin key";
  } else if (response.status === 429) {
    kind = "rate_limited";
    hint = retryAfterSeconds === undefined
      ? "rate limited at 120 requests/minute per IP; retry later"
      : `rate limited; retry after ${retryAfterSeconds}s`;
  } else if (response.status === 400) {
    kind = "bad_request";
  } else if (response.status === 404) {
    kind = "not_found";
  } else if (response.status >= 500) {
    kind = "server";
  }
  return new LookerApiError(response.status, message, kind, code, hint, retryAfterSeconds);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1_000));
}
