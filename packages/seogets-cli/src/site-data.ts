/**
 * Response shaping for the SEO Gets read tools beyond GSC ranking: merged
 * GSC + GA4 performance, site page/query inventories, the content-change
 * timeline, and content groups / topic clusters. Each helper turns the
 * upstream envelope into flat rows so `--format csv|json` stays
 * metadata-free; commands expose `--raw` for the envelope itself.
 */

import { normalizeGscPage, type GscRow } from "./gsc-top.ts";

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The boilerplate instruction SEO Gets appends to every performance note. */
const BOILERPLATE_NOTE = "Use only the data included in the response";

/**
 * Warnings worth showing a human: the part of the performance note before the
 * boilerplate (e.g. "GA4 request failed, web metrics are not included") and
 * any portfolio sites the server skipped.
 */
export function performanceWarnings(envelope: unknown): string[] {
  const record = asRecord(envelope);
  const warnings: string[] = [];
  if (typeof record.note === "string") {
    const cut = record.note.indexOf(BOILERPLATE_NOTE);
    const specific = (cut === -1 ? record.note : record.note.slice(0, cut)).trim();
    if (specific) warnings.push(specific);
  }
  const skipped = asArray(record.skipped_sites).map(String);
  if (skipped.length > 0) warnings.push(`skipped sites: ${skipped.join(", ")}`);
  return warnings;
}

export function performanceRows(envelope: unknown): GscRow[] {
  return normalizeGscPage(envelope).rows;
}

export interface PageRow {
  url: string;
  host: string;
  path: string;
}

/** `list_site_pages` groups paths under hosts; flatten to one row per URL. */
export function pageRows(envelope: unknown): PageRow[] {
  const rows: PageRow[] = [];
  for (const entry of asArray(asRecord(envelope).hosts)) {
    const { host, paths } = asRecord(entry);
    const hostText = typeof host === "string" ? host.replace(/\/$/, "") : "";
    for (const path of asArray(paths)) {
      const pathText = String(path);
      rows.push({ url: `${hostText}${pathText}`, host: hostText, path: pathText });
    }
  }
  return rows;
}

export function queryRows(envelope: unknown): Array<{ query: string }> {
  return asArray(asRecord(envelope).queries).map((query) => ({ query: String(query) }));
}

/** `list_content_changes` groups items under days; flatten to one row per item. */
export function changeRows(envelope: unknown): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const day of asArray(asRecord(envelope).days)) {
    const { date, items } = asRecord(day);
    for (const item of asArray(items)) rows.push({ date, ...asRecord(item) });
  }
  return rows;
}

export function listRows(envelope: unknown, key: string): Record<string, unknown>[] {
  return asArray(asRecord(envelope)[key]).map(asRecord);
}

export function hasMore(envelope: unknown): boolean {
  return asRecord(envelope).has_more === true;
}

/** Hard stop for `--all` so a server that never clears `has_more` cannot loop forever. */
export const MAX_LIST_PAGES = 500;

/**
 * Walk a `page`/`page_size`/`has_more` list tool from `startPage` until the
 * server reports no more rows, collecting each page's rows.
 */
export async function collectPages<T>(
  fetchPage: (page: number) => Promise<unknown>,
  toRows: (envelope: unknown) => T[],
  startPage = 1,
): Promise<{ rows: T[]; pages: number; complete: boolean }> {
  const rows: T[] = [];
  let page = startPage;
  for (let fetched = 1; fetched <= MAX_LIST_PAGES; fetched += 1, page += 1) {
    const envelope = await fetchPage(page);
    rows.push(...toRows(envelope));
    if (!hasMore(envelope)) return { rows, pages: fetched, complete: true };
  }
  return { rows, pages: MAX_LIST_PAGES, complete: false };
}
