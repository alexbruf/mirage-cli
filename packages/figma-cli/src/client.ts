import { getDefaultBaseUrl, type AuthScheme } from "./config.ts";

/**
 * Figma REST API client. Plain `fetch`, no SDK, no Node-only imports — runs
 * unchanged under workerd.
 *
 * Unlike the read-only clients in this monorepo this one can mutate, because
 * comments, variables, and dev resources all have write endpoints we expose.
 * The read/write boundary is therefore NOT enforced here; it is enforced one
 * layer up, by the host's mount mode (ve-brain gates the write subcommands on
 * a `mode: "write"` mount). Keep the verbs explicit so that gating has clean
 * command names to match on.
 *
 * Docs: https://developers.figma.com/docs/rest-api/
 */

export type Query = Record<string, string | number | boolean | string[] | undefined>;

export interface ListEnvelope {
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
  scheme: AuthScheme;
  baseUrl?: string;
}

type Method = "GET" | "POST" | "PUT" | "DELETE";

/**
 * Figma's rate limits are low and tiered: file/nodes/image renders (Tier 1) are
 * 10/min on Starter and only 20/min on Organization. A single retry that
 * honours `Retry-After` is worth it; anything longer belongs to the caller, who
 * can see the reset window in the error hint.
 */
const MAX_RETRY_AFTER_SECONDS = 35;

export class FigmaClient {
  private readonly token: string;
  private readonly scheme: AuthScheme;
  private readonly baseUrl: string;

  constructor(opts: ClientOptions) {
    this.token = opts.token;
    this.scheme = opts.scheme;
    this.baseUrl = (opts.baseUrl ?? getDefaultBaseUrl()).replace(/\/$/, "");
  }

  get<T = unknown>(path: string, query: Query = {}): Promise<T> {
    return this.request<T>("GET", path, query);
  }

  post<T = unknown>(path: string, body?: unknown, query: Query = {}): Promise<T> {
    return this.request<T>("POST", path, query, body);
  }

  put<T = unknown>(path: string, body?: unknown, query: Query = {}): Promise<T> {
    return this.request<T>("PUT", path, query, body);
  }

  del<T = unknown>(path: string, query: Query = {}): Promise<T> {
    return this.request<T>("DELETE", path, query);
  }

  private async request<T>(
    method: Method,
    path: string,
    query: Query,
    body?: unknown,
  ): Promise<T> {
    const url = this.buildUrl(path, query);
    let res = await this.send(method, url, body);
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? Number.NaN);
      if (Number.isFinite(retryAfter) && retryAfter <= MAX_RETRY_AFTER_SECONDS) {
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        res = await this.send(method, url, body);
      }
    }
    if (!res.ok) throw await errorFromResponse(res);
    // DELETE endpoints answer 200 with an empty body on success.
    const text = await res.text();
    if (text.length === 0) return { status: res.status } as T;
    return JSON.parse(text) as T;
  }

  private send(method: Method, url: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.scheme === "bearer") headers.Authorization = `Bearer ${this.token}`;
    else headers["X-Figma-Token"] = this.token;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  private buildUrl(path: string, query: Query): string {
    const suffix = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${suffix}`);
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      // Figma takes comma-joined lists (ids, node_ids), never repeated keys.
      url.searchParams.set(k, Array.isArray(v) ? v.join(",") : String(v));
    }
    return url.toString();
  }
}

/**
 * Fetch a rendered export. `GET /v1/images/:key` does not return bytes — it
 * returns short-lived S3 URLs on a different host that must be fetched WITHOUT
 * the Figma credential (sending it is a signature mismatch, not just waste).
 */
export async function fetchRenderedImage(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      `could not download the rendered image: ${res.statusText}`,
      "render URLs expire ~30 days after they are issued; re-run the export to get a fresh one",
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function errorFromResponse(res: Response): Promise<ApiError> {
  const text = await res.text();
  let message: string;
  try {
    const json = JSON.parse(text) as { err?: string; message?: string; error?: string };
    message = json.err ?? json.message ?? json.error ?? text;
  } catch {
    message = text || res.statusText;
  }

  let hint: string | undefined;
  if (res.status === 400) hint = "bad parameter — check --ids node ids and --depth";
  if (res.status === 401) hint = "credential invalid or expired (personal access tokens last ≤90 days)";
  if (res.status === 403) {
    hint =
      "the token lacks the scope for this endpoint, or the account cannot see this file. " +
      "Reads need file_content:read; comments need file_comments:read|write; variables need " +
      "file_variables:read|write and an Enterprise plan";
  }
  if (res.status === 404) hint = "file key, node id, project, or team not found";
  if (res.status === 429) {
    const parts = ["rate limited"];
    const type = res.headers.get("x-figma-rate-limit-type");
    const tier = res.headers.get("x-figma-plan-tier");
    const retryAfter = res.headers.get("retry-after");
    if (tier) parts.push(`plan=${tier}`);
    if (type) parts.push(`limit=${type}`);
    if (retryAfter) parts.push(`retry after ${retryAfter}s`);
    const upgrade = res.headers.get("x-figma-upgrade-link");
    if (upgrade) parts.push(`upgrade: ${upgrade}`);
    // Tier 1 is as low as 10/min. Batch --ids instead of looping per node.
    parts.push("batch node ids into one call rather than looping");
    hint = parts.join("; ");
  }
  return new ApiError(res.status, message, hint);
}
