import { reportCost } from "@mirage-cli/core";
import { basicAuthHeader, loadCredentials } from "./auth.ts";

const API_BASE = "https://api.dataforseo.com";

/**
 * DataForSEO prices every call server-side and returns the figure on the
 * response, so we never estimate: `cost` is the account's actual charge in
 * USD. Report it from here, the one place every request passes through.
 *
 * Reported even when zero. A free endpoint returning `cost: 0` and a call that
 * never happened are different facts, and only the first produces a row.
 *
 * `reportCost` is a no-op outside a mirage run, so the standalone `dfs` binary
 * is unaffected.
 */
function reportDfsCost(parsed: DfsResponse, statusCode: number): void {
  const top = typeof parsed.cost === "number" ? parsed.cost : null;
  // Older/batched shapes omit the top-level total and price per task.
  const perTask = Array.isArray(parsed.tasks)
    ? parsed.tasks.reduce<number | null>((sum, t) => {
        const c = (t as { cost?: unknown }).cost;
        return typeof c === "number" ? (sum ?? 0) + c : sum;
      }, null)
    : null;
  reportCost({
    provider: "dataforseo",
    usd: top ?? perTask,
    statusCode,
  });
}

export type DfsResponse = {
  status_code?: number;
  status_message?: string;
  cost?: number;
  tasks?: Array<{
    status_code?: number;
    status_message?: string;
    result?: unknown;
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
};

export type CallOptions = {
  /** Wrap a single task object as `[task]` for endpoints that take an array body. Default: true. */
  wrapAsTaskArray?: boolean;
  /** Override base URL (rare). */
  baseUrl?: string;
  /** Request timeout in ms (default 120_000). */
  timeoutMs?: number;
};

/**
 * Call any DataForSEO endpoint. Path may be absolute (`/v3/serp/...`)
 * or relative (`serp/...`); leading `v3/` is added if missing.
 */
export async function call(
  path: string,
  body: unknown,
  opts: CallOptions = {},
): Promise<DfsResponse> {
  const creds = loadCredentials();
  const url = buildUrl(path, opts.baseUrl);

  const payload = preparePayload(body, opts.wrapAsTaskArray ?? true);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120_000);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(creds),
        "Content-Type": "application/json",
        "User-Agent": "dataforseo-cli/0.1.0",
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let parsed: DfsResponse;
  try {
    parsed = text ? (JSON.parse(text) as DfsResponse) : {};
  } catch {
    throw new Error(`HTTP ${res.status}: non-JSON response: ${text.slice(0, 500)}`);
  }

  // Before the error check: a rejected call can still be billed, and a failure
  // whose spend is invisible is exactly the gap this reporting exists to close.
  reportDfsCost(parsed, res.status);

  if (!res.ok) {
    const msg = parsed.status_message ?? `HTTP ${res.status}`;
    throw new Error(`DataForSEO error: ${msg}`);
  }

  return parsed;
}

/** GET helper for the few `GET` endpoints (locations, languages, user, errors). */
export async function get(path: string, opts: CallOptions = {}): Promise<DfsResponse> {
  const creds = loadCredentials();
  const url = buildUrl(path, opts.baseUrl);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 60_000);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: basicAuthHeader(creds),
        "User-Agent": "dataforseo-cli/0.1.0",
      },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  const parsed = text ? (JSON.parse(text) as DfsResponse) : {};
  reportDfsCost(parsed, res.status);
  if (!res.ok) {
    throw new Error(`DataForSEO error: ${parsed.status_message ?? `HTTP ${res.status}`}`);
  }
  return parsed;
}

function buildUrl(path: string, baseUrl?: string): string {
  let p = path.trim();
  if (!p.startsWith("/")) p = "/" + p;
  if (!p.startsWith("/v3/")) p = "/v3" + p;
  return (baseUrl ?? API_BASE) + p;
}

function preparePayload(body: unknown, wrap: boolean): unknown {
  if (body === undefined || body === null) return undefined;
  if (Array.isArray(body)) return body;
  if (wrap && typeof body === "object") return [body];
  return body;
}

/**
 * Extract result rows from a DataForSEO response.
 * DataForSEO nests results as `tasks[*].result[*]` — most useful data is the
 * first task's result array, which itself often contains an `items` field.
 */
export function extractItems(resp: DfsResponse): unknown[] {
  const tasks = resp.tasks ?? [];
  const out: unknown[] = [];
  for (const task of tasks) {
    const result = task.result;
    if (!Array.isArray(result)) continue;
    for (const r of result) {
      if (r && typeof r === "object" && Array.isArray((r as { items?: unknown }).items)) {
        out.push(...((r as { items: unknown[] }).items));
      } else {
        out.push(r);
      }
    }
  }
  return out;
}
