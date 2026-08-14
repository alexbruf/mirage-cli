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

/**
 * DataForSEO reports failure INSIDE an HTTP 200. The transport succeeded, so
 * `res.ok` is true and the envelope says `status_code: 20000, "Ok."`; the real
 * outcome sits one level down, per task:
 *
 *   { status_code: 20000, status_message: "Ok.", tasks_error: 1,
 *     tasks: [ { status_code: 40501,
 *                status_message: "Invalid Field: 'location_code'.",
 *                result: null } ] }
 *
 * Nothing used to look at that. `extractItems` skips any task whose `result`
 * is not an array — which is exactly what a failed task looks like — so the
 * caller got `[]` and exit 0. A rejected credential, an exhausted balance, a
 * rate limit, a bad parameter and a query that legitimately had no results
 * were indistinguishable. That cost a real outage six hours of diagnosis and
 * put the word "unauthorized" into a client deliverable, because the only
 * honest thing an agent can conclude from `[]` is a guess.
 *
 * Throwing is the whole fix: `bin.ts` already prints `{"error": …}` to stderr
 * and exits 1, and only HTTP-level failures ever reached it.
 */
const SUCCESS_MIN = 20_000;
const SUCCESS_MAX = 30_000;

function isSuccess(code: number | undefined): boolean {
  return typeof code === "number" && code >= SUCCESS_MIN && code < SUCCESS_MAX;
}

/**
 * Two failures are worth naming because the reader can act on them; every
 * other code passes the vendor's own wording through untouched.
 *
 * Deliberately exact rather than by numeric family. Per DataForSEO's error
 * appendix only 40100 is "rejected credentials" and only 40200/40210 are
 * balance; their neighbours cover rate limits, account holds, subscriptions
 * and IP policy, so `code >= 40100 && code < 40200` would mislabel them.
 * https://docs.dataforseo.com/v3/appendix/errors/
 */
function hint(code: number): string {
  if (code === 40_100) return " (the API rejected these credentials)";
  if (code === 40_200 || code === 40_210) return " (the account balance is exhausted)";
  return "";
}

function describe(code: number | undefined, message: unknown): string {
  const text = typeof message === "string" && message ? message : "no message";
  if (typeof code !== "number") return `DataForSEO error: ${text}`;
  return `DataForSEO error ${code}: ${text}${hint(code)}`;
}

/**
 * Fail on a 200 that reports an error. Called by both `call` and `get` right
 * after their existing HTTP check, so every command inherits it — including
 * `--full` and `raw` — with no per-command changes and no new flags. A caller
 * should never have to know a flag exists to be told why something failed.
 *
 * Partial batches keep their good rows. Requests here normally carry one task
 * (`preparePayload` wraps a single body as `[body]`), but the API accepts
 * arrays, and those rows are already paid for — discarding them to report a
 * sibling's failure would trade one silent loss for another. The failure still
 * goes to stderr, so it is surfaced either way; what changes is whether the
 * successful half survives.
 */
export function assertResponseOk(parsed: DfsResponse): void {
  if (parsed.status_code !== undefined && !isSuccess(parsed.status_code)) {
    // A bad envelope status invalidates the whole response, tasks included.
    throw new Error(describe(parsed.status_code, parsed.status_message));
  }

  const tasks = parsed.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) return;

  const failed = tasks.filter((t) => !isSuccess(t.status_code));
  const first = failed[0];
  if (!first) return;

  if (failed.length === tasks.length) {
    throw new Error(describe(first.status_code, first.status_message));
  }

  for (const t of failed) {
    console.error(`warning: ${describe(t.status_code, t.status_message)}`);
  }
}

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

  assertResponseOk(parsed);

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
  assertResponseOk(parsed);
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
