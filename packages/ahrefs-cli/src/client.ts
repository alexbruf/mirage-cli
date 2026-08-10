import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { reportCost } from "@mirage-cli/core";

const BASE_URL = "https://api.ahrefs.com/v3";
const CACHE_DIR = join(homedir(), ".cache", "ahrefs-cli");

export interface RequestOptions {
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  method?: "GET" | "POST";
  body?: unknown;
  cacheTtlSec?: number;
}

export interface ApiError extends Error {
  status: number;
  body: unknown;
}

function getApiKey(override?: string): string {
  const key = override ?? process.env.AHREFS_API_KEY;
  if (!key) {
    throw new Error(
      "Missing API key. Set AHREFS_API_KEY in your environment or pass --api-key.",
    );
  }
  return key;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(BASE_URL + (path.startsWith("/") ? path : "/" + path));
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function cacheKey(url: string, method: string, body: unknown): string {
  const h = createHash("sha256");
  h.update(method);
  h.update("\0");
  h.update(url);
  h.update("\0");
  if (body !== undefined) h.update(JSON.stringify(body));
  return h.digest("hex");
}

function readCache(key: string, ttlSec: number): unknown | undefined {
  const file = join(CACHE_DIR, key + ".json");
  if (!existsSync(file)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as {
      ts: number;
      data: unknown;
    };
    if (Date.now() - raw.ts > ttlSec * 1000) return undefined;
    return raw.data;
  } catch {
    return undefined;
  }
}

function writeCache(key: string, data: unknown): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const file = join(CACHE_DIR, key + ".json");
  writeFileSync(file, JSON.stringify({ ts: Date.now(), data }));
}

export async function request<T = unknown>(
  opts: RequestOptions,
  apiKey?: string,
): Promise<T> {
  const method = opts.method ?? "GET";
  const url = buildUrl(opts.path, opts.query);
  const key = getApiKey(apiKey);

  const cKey = cacheKey(url, method, opts.body);
  if (opts.cacheTtlSec && method === "GET") {
    const hit = readCache(cKey, opts.cacheTtlSec);
    if (hit !== undefined) return hit as T;
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  // Ahrefs bills in "units" and reports the real figure on response headers:
  // `x-api-units-cost-total-actual` is what the request actually consumed,
  // as opposed to `-total` which is the pre-flight estimate. Cache hits
  // (`x-api-cache`) consume nothing and report 0, which is still worth
  // recording — a free call and a call that never happened are different.
  //
  // Note this is unrelated to the `unitsCost` in spec.ts: that one is parsed
  // out of Ahrefs' own column *documentation* ("(N units)" prefixes) to warn
  // about expensive fields before a request. It is a price list, not usage.
  //
  // Units are not converted to dollars here. The rate depends on the plan the
  // account is on, which this API does not expose.
  const unitsHeader =
    res.headers.get("x-api-units-cost-total-actual") ??
    res.headers.get("x-api-units-cost-total");
  const units = unitsHeader !== null ? Number(unitsHeader) : null;
  reportCost({
    provider: "ahrefs",
    units: units !== null && Number.isFinite(units) ? units : null,
    statusCode: res.status,
  });

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    const err = new Error(
      `Ahrefs API ${res.status}: ${
        typeof parsed === "object" && parsed && "error" in parsed
          ? (parsed as { error: string }).error
          : text.slice(0, 200)
      }`,
    ) as ApiError;
    err.status = res.status;
    err.body = parsed;
    throw err;
  }

  if (opts.cacheTtlSec && method === "GET") writeCache(cKey, parsed);
  return parsed as T;
}
