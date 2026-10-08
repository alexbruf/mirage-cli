/**
 * Rank-history date windows and the whole-project history export.
 *
 * looker.so's history endpoint takes only `days` (1-365, counted back from
 * today). `--since` / `--until` are converted to the smallest `days` that
 * covers them, and checks outside the window are dropped here.
 *
 * `keywords history-all` makes one history call per keyword. looker.so allows
 * 120 requests a minute per IP, and a Mirage CLI call has a wall-clock limit
 * (90s by default), so the export runs in chunks: each call paces itself,
 * stops before `--max-seconds`, and reports `next_offset` for the next call.
 */

import { LookerApiError, type LookerClient } from "./client.ts";
import { historyRow } from "./export.ts";

export const MAX_HISTORY_DAYS = 365;
const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface WindowOptions {
  days?: number;
  since?: string;
  until?: string;
}

export interface HistoryWindow {
  days: number;
  since?: string;
  until?: string;
}

export function resolveWindow(options: WindowOptions, now: Date = new Date()): HistoryWindow {
  const { days, since, until } = options;
  if (days !== undefined && since !== undefined) throw new Error("pass --days or --since, not both");
  for (const [flag, value] of [["--since", since], ["--until", until]] as const) {
    if (value !== undefined && (!DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))) {
      throw new Error(`${flag} must be a date like 2026-07-01; got ${JSON.stringify(value)}`);
    }
  }
  if (since && until && since > until) throw new Error("--since must be on or before --until");
  if (days !== undefined && (days < 1 || days > MAX_HISTORY_DAYS)) {
    throw new Error(`--days must be 1-${MAX_HISTORY_DAYS}`);
  }
  if (since === undefined) return { days: days ?? 30, ...(until ? { until } : {}) };

  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const needed = Math.floor((today - Date.parse(`${since}T00:00:00Z`)) / DAY_MS) + 1;
  if (needed > MAX_HISTORY_DAYS) {
    const earliest = new Date(today - (MAX_HISTORY_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
    throw new Error(`looker.so returns at most ${MAX_HISTORY_DAYS} days of history; --since must be ${earliest} or later`);
  }
  return { days: Math.max(1, needed), since, ...(until ? { until } : {}) };
}

interface HistoryPayload {
  keyword?: unknown;
  series?: Array<{ label?: unknown; isTarget?: unknown; points?: Array<{ date?: unknown }> }>;
  [key: string]: unknown;
}

/** Drop checks outside `since`..`until` (inclusive), keeping the response shape. */
export function filterHistory<T>(value: T, window: HistoryWindow): T {
  if (!window.since && !window.until) return value;
  const payload = value as HistoryPayload;
  if (!payload || !Array.isArray(payload.series)) return value;
  const inWindow = (date: unknown) =>
    typeof date === "string" &&
    (!window.since || date >= window.since) &&
    (!window.until || date <= window.until);
  return {
    ...payload,
    series: payload.series.map((series) => ({
      ...series,
      points: (series.points ?? []).filter((point) => inWindow(point?.date)),
    })),
  } as T;
}

export interface HistoryAllOptions extends HistoryWindow {
  offset: number;
  limit?: number;
  maxSeconds: number;
  targetOnly: boolean;
  /** Minimum gap between history calls; 550ms keeps under 120 a minute. */
  minIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (done: number, total: number) => void;
}

export interface HistoryAllResult {
  projectId: string;
  window: HistoryWindow;
  keywords_total: number;
  offset: number;
  processed: number;
  next_offset: number | null;
  complete: boolean;
  failed: Array<{ keywordId: string; keyword: unknown; error: string }>;
  rows: Record<string, unknown>[];
}

export async function historyAll(
  client: LookerClient,
  projectId: string,
  options: HistoryAllOptions,
): Promise<HistoryAllResult> {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const minInterval = options.minIntervalMs ?? 550;
  const deadline = now() + options.maxSeconds * 1000;

  const keywords = await client.get<Array<{ id: string; keyword?: unknown }>>(
    `/projects/${encodeURIComponent(projectId)}/keywords`,
  );
  const end = options.limit === undefined ? keywords.length : Math.min(keywords.length, options.offset + options.limit);
  const slice = keywords.slice(options.offset, end);

  const rows: Record<string, unknown>[] = [];
  const failed: HistoryAllResult["failed"] = [];
  let processed = 0;
  let lastCall = 0;

  for (const keyword of slice) {
    // Leave room for one more call plus writing the file.
    if (now() + minInterval + 5_000 > deadline) break;
    let attempt = 0;
    for (;;) {
      const wait = lastCall + minInterval - now();
      if (wait > 0) await sleep(wait);
      lastCall = now();
      try {
        const history = filterHistory(
          await client.get<HistoryPayload>(`/keywords/${encodeURIComponent(keyword.id)}/history`, { days: options.days }),
          options,
        );
        for (const series of history.series ?? []) {
          if (options.targetOnly && series.isTarget !== true) continue;
          for (const point of series.points ?? []) rows.push(historyRow(keyword.keyword, series, point, keyword.id));
        }
        break;
      } catch (error) {
        const retryAfter = error instanceof LookerApiError && error.kind === "rate_limited"
          ? (error.retryAfterSeconds ?? 30) * 1000
          : null;
        if (retryAfter !== null && attempt === 0 && now() + retryAfter + 5_000 < deadline) {
          attempt++;
          await sleep(retryAfter);
          continue;
        }
        if (retryAfter !== null) {
          // Still limited, or no time to wait: stop here and resume at this keyword.
          return finish();
        }
        failed.push({ keywordId: keyword.id, keyword: keyword.keyword, error: error instanceof Error ? error.message : String(error) });
        break;
      }
    }
    processed++;
    options.onProgress?.(options.offset + processed, keywords.length);
  }
  return finish();

  function finish(): HistoryAllResult {
    const next = options.offset + processed;
    const complete = next >= end;
    return {
      projectId,
      window: { days: options.days, ...(options.since ? { since: options.since } : {}), ...(options.until ? { until: options.until } : {}) },
      keywords_total: keywords.length,
      offset: options.offset,
      processed,
      next_offset: complete && end === keywords.length ? null : next,
      complete: complete && end === keywords.length,
      failed,
      rows,
    };
  }
}
