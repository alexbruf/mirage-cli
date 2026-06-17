import { getDefaultBaseUrl } from "./config.ts";

/**
 * Read-only Airtable Web API client. The only HTTP verb this class can emit is
 * GET — the create/update/delete surface deliberately does not exist, so a
 * wrapped LLM driver cannot mutate Airtable data even by constructing odd
 * commands. See [[cli-readwrite-boundary]].
 *
 * Auth is a single Personal Access Token (PAT) bearer; the legacy API-key auth
 * was removed by Airtable in Feb 2024.
 *
 * Docs: https://airtable.com/developers/web/api/introduction
 */

export type Query = Record<string, string | number | boolean | string[] | undefined>;

/** Cursor-pagination envelope. The collection key varies by endpoint
 * (`records` for data, `bases` for the meta list), so callers name it. */
export interface ListEnvelope {
  offset?: string;
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
  token: string;
  baseUrl?: string;
}

export class AirtableClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(opts: ClientOptions) {
    this.token = opts.token;
    this.baseUrl = (opts.baseUrl ?? getDefaultBaseUrl()).replace(/\/$/, "");
  }

  /** GET an absolute path (e.g. `/meta/bases`, `/appXXX/Table%20Name`). */
  async get<T = unknown>(path: string, query: Query = {}): Promise<T> {
    const url = this.buildUrl(path, query);
    let res = await this.fetch(url);
    // 429: Airtable enforces 5 req/s per base with a 30s lockout. Honor a short
    // Retry-After once; otherwise surface it.
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? Number.NaN);
      if (Number.isFinite(retryAfter) && retryAfter <= 35) {
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        res = await this.fetch(url);
      }
    }
    if (!res.ok) throw await errorFromResponse(res);
    return (await res.json()) as T;
  }

  private fetch(url: string): Promise<Response> {
    return fetch(url, {
      // GET only, by design. No method parameter exists on this client.
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.token}`,
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
        // Airtable repeats array params with `[]` indices, e.g. fields[]=a&fields[]=b.
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
    const json = JSON.parse(text) as { error?: string | { type?: string; message?: string } };
    const err = json.error;
    message = typeof err === "string" ? err : (err?.message ?? err?.type ?? text);
  } catch {
    message = text || res.statusText;
  }
  let hint: string | undefined;
  if (res.status === 401) hint = "token invalid — check the personal access token (PAT)";
  if (res.status === 403)
    hint = "the PAT lacks access to this base/scope — grant it the base and a read scope";
  if (res.status === 404) hint = "base id, table name/id, or record id not found";
  if (res.status === 422) hint = "bad request param (check --filter formula, --view, or --fields)";
  if (res.status === 429) hint = "rate limited (5 req/s per base; 30s lockout)";
  return new ApiError(res.status, message, hint);
}
