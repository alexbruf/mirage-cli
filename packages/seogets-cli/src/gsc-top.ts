export type GscDimension = "query" | "page";
export type GscMetric = "impressions" | "clicks" | "position";

export interface GscRow {
  query?: string;
  page?: string;
  date?: string;
  country?: string;
  device?: string;
  contentGroup?: string;
  topicCluster?: string;
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
  [key: string]: unknown;
}

export interface GscPageArgs {
  site: string;
  start_date: string;
  end_date: string;
  dimensions: string[];
  /** @deprecated get_gsc_performance rejects pagination params; never sent. */
  page?: number;
  /** @deprecated get_gsc_performance rejects pagination params; never sent. */
  page_size?: number;
  branded_queries?: boolean;
  [key: string]: unknown;
}

export interface GscPage {
  rows: GscRow[];
  envelope: Record<string, unknown>;
}

export interface GscPager {
  getGscPage(args: GscPageArgs): Promise<GscPage>;
}

export interface GscTopParams {
  site: string;
  startDate: string;
  endDate: string;
  dimension: GscDimension;
  metric: GscMetric;
  limit: number;
  /** @deprecated the server no longer paginates; ignored. */
  pageSize?: number;
  /** @deprecated the server no longer paginates; ignored. */
  maxPages?: number;
  brandedQueries?: boolean;
  filters?: Record<string, unknown>;
}

export interface GscTopResult {
  rows: GscRow[];
  pagesFetched: number;
  rowsScanned: number;
  truncatedByCap: boolean;
}

export interface GscCompareParams {
  site: string;
  query: string;
  currentStart: string;
  currentEnd: string;
  compareStart: string;
  compareEnd: string;
  metric: GscMetric;
  /** @deprecated the server no longer paginates; ignored. */
  pageSize?: number;
  /** @deprecated the server no longer paginates; ignored. */
  maxPages?: number;
  brandedQueries?: boolean;
  filters?: Record<string, unknown>;
}

export interface GscCompareResult {
  label: string;
  current: number;
  prior: number;
  delta_abs: number;
  delta_pct: number | null;
  found: boolean;
  found_current: boolean;
  found_prior: boolean;
  truncated: boolean;
}

/**
 * get_gsc_performance returns the whole window in one response, capped at
 * this many rows (observed server behavior). A response exactly at the cap
 * is almost certainly truncated, and there is no way to fetch the rest.
 */
export const SERVER_ROW_CAP = 50_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeHeader(header: string): string {
  const compact = header.trim().replace(/^\uFEFF/, "");
  const normalized = compact
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (normalized === "content_group") return "contentGroup";
  if (normalized === "topic_cluster") return "topicCluster";
  return normalized;
}

function parseMetricCell(key: string, value: string): string | number {
  if (!["clicks", "impressions", "ctr", "position"].includes(key)) return value;
  const trimmed = value.trim();
  if (trimmed === "") return 0;
  const numeric = Number(trimmed.replace(/[%,$]/g, "").replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return value;
  return numeric;
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:tsv|csv|text)?\s*/i, "").replace(/\s*```$/, "").trim();
}

export function parseGscTsv(value: string): GscRow[] {
  const text = stripCodeFence(value);
  if (!text) return [];
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2 || !lines[0]?.includes("\t")) return [];

  const headers = lines[0].split("\t").map(normalizeHeader);
  if (!headers.some((header) => ["query", "page", "clicks", "impressions"].includes(header))) {
    return [];
  }

  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row: GscRow = {};
    for (let index = 0; index < headers.length; index += 1) {
      const key = headers[index];
      if (!key) continue;
      row[key] = parseMetricCell(key, cells[index] ?? "");
    }
    return row;
  });
}

function rowsFromUnknown(value: unknown, seen = new Set<unknown>()): GscRow[] | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return rowsFromUnknown(JSON.parse(trimmed), seen);
      } catch {
        // It may still be a table whose first cell begins with punctuation.
      }
    }
    const rows = parseGscTsv(trimmed);
    return rows.length > 0 || trimmed.includes("\t") ? rows : null;
  }
  if (Array.isArray(value)) {
    return value.filter((row): row is GscRow => asRecord(row) !== null);
  }
  const record = asRecord(value);
  if (!record || seen.has(value)) return null;
  seen.add(value);
  for (const key of ["rows", "data", "results", "performance"]) {
    if (!(key in record)) continue;
    const rows = rowsFromUnknown(record[key], seen);
    if (rows !== null) return rows;
  }
  return null;
}

export function normalizeGscPage(value: unknown): GscPage {
  const envelope = asRecord(value) ?? {};
  const rows = rowsFromUnknown(value);
  if (rows === null) {
    throw new Error(
      "SEO Gets get_gsc_performance returned an unsupported payload. Expected rows or TSV text under data.",
    );
  }
  return { rows, envelope };
}

function nestedRecords(envelope: Record<string, unknown>): Record<string, unknown>[] {
  const records = [envelope];
  for (const key of ["pagination", "meta", "metadata", "page_info"]) {
    const nested = asRecord(envelope[key]);
    if (nested) records.push(nested);
  }
  return records;
}

function numberField(records: Record<string, unknown>[], keys: string[]): number | undefined {
  for (const record of records) {
    for (const key of keys) {
      const value = Number(record[key]);
      if (Number.isFinite(value)) return value;
    }
  }
  return undefined;
}

/** @deprecated get_gsc_performance no longer paginates; kept for callers that inspect legacy envelopes. */
export function pageHasMore(
  envelope: Record<string, unknown>,
  rowCount: number,
  pageSize: number,
  page: number,
): boolean {
  const records = nestedRecords(envelope);
  for (const record of records) {
    for (const key of ["has_more", "hasMore", "next_page", "nextPage"]) {
      if (typeof record[key] === "boolean") return record[key] as boolean;
      if (record[key] !== undefined && record[key] !== null) return true;
    }
  }
  const totalPages = numberField(records, ["total_pages", "totalPages", "page_count", "pageCount"]);
  if (totalPages !== undefined) return page < totalPages;
  const totalRows = numberField(records, ["total", "total_rows", "totalRows", "total_items", "totalItems"]);
  if (totalRows !== undefined) return page * pageSize < totalRows;
  return rowCount === pageSize && rowCount > 0;
}

export function metricOf(row: GscRow, metric: GscMetric): number | null {
  const value = Number(row[metric]);
  return Number.isFinite(value) ? value : null;
}

function labelOf(row: GscRow, dimension: GscDimension): string | null {
  const value = row[dimension];
  return typeof value === "string" && value !== "" ? value : null;
}

function compareRows(
  left: GscRow,
  right: GscRow,
  dimension: GscDimension,
  metric: GscMetric,
): number {
  const leftMetric = metricOf(left, metric) ?? (metric === "position" ? Infinity : -Infinity);
  const rightMetric = metricOf(right, metric) ?? (metric === "position" ? Infinity : -Infinity);
  const metricOrder = metric === "position" ? leftMetric - rightMetric : rightMetric - leftMetric;
  if (metricOrder !== 0) return metricOrder;
  const labelOrder = (labelOf(left, dimension) ?? "").localeCompare(labelOf(right, dimension) ?? "");
  if (labelOrder !== 0) return labelOrder;
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

export class BoundedMinHeap<T> {
  private readonly values: T[] = [];

  constructor(
    private readonly capacity: number,
    private readonly compareBest: (left: T, right: T) => number,
  ) {}

  offer(value: T): void {
    if (this.capacity < 1) return;
    if (this.values.length < this.capacity) {
      this.values.push(value);
      this.bubbleUp(this.values.length - 1);
      return;
    }
    const worst = this.values[0];
    if (worst === undefined || this.compareBest(value, worst) >= 0) return;
    this.values[0] = value;
    this.bubbleDown(0);
  }

  drainSorted(): T[] {
    return [...this.values].sort(this.compareBest);
  }

  private isWorse(left: T, right: T): boolean {
    return this.compareBest(left, right) > 0;
  }

  private bubbleUp(start: number): void {
    let index = start;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      const value = this.values[index];
      const parentValue = this.values[parent];
      if (value === undefined || parentValue === undefined || !this.isWorse(value, parentValue)) break;
      [this.values[index], this.values[parent]] = [parentValue, value];
      index = parent;
    }
  }

  private bubbleDown(start: number): void {
    let index = start;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let worse = index;
      const leftValue = this.values[left];
      const worseValue = this.values[worse];
      if (leftValue !== undefined && worseValue !== undefined && this.isWorse(leftValue, worseValue)) {
        worse = left;
      }
      const rightValue = this.values[right];
      const selected = this.values[worse];
      if (rightValue !== undefined && selected !== undefined && this.isWorse(rightValue, selected)) {
        worse = right;
      }
      if (worse === index) break;
      const current = this.values[index];
      const replacement = this.values[worse];
      if (current === undefined || replacement === undefined) break;
      [this.values[index], this.values[worse]] = [replacement, current];
      index = worse;
    }
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : fallback;
}

function requestArgs(
  params: Pick<GscTopParams, "site" | "startDate" | "endDate" | "dimension" | "brandedQueries" | "filters">,
): GscPageArgs {
  return {
    site: params.site,
    start_date: params.startDate,
    end_date: params.endDate,
    dimensions: [params.dimension],
    ...(params.brandedQueries !== undefined ? { branded_queries: params.brandedQueries } : {}),
    ...(params.filters ?? {}),
  };
}

export async function gscTopBy(client: GscPager, params: GscTopParams): Promise<GscTopResult> {
  const limit = positiveInteger(params.limit, 1);
  const top = new BoundedMinHeap<GscRow>(limit, (left, right) =>
    compareRows(left, right, params.dimension, params.metric),
  );
  const result = await client.getGscPage(requestArgs(params));
  for (const row of result.rows) {
    if (labelOf(row, params.dimension) === null || metricOf(row, params.metric) === null) continue;
    top.offer(row);
  }
  return {
    rows: top.drainSorted(),
    pagesFetched: 1,
    rowsScanned: result.rows.length,
    truncatedByCap: result.rows.length >= SERVER_ROW_CAP,
  };
}

async function findQueryMetric(
  client: GscPager,
  params: Omit<GscTopParams, "limit">,
  query: string,
): Promise<{ value: number; found: boolean; truncated: boolean }> {
  const result = await client.getGscPage(requestArgs(params));
  const match = result.rows.find((row) => row.query === query);
  const metric = match ? metricOf(match, params.metric) : null;
  if (metric !== null) return { value: metric, found: true, truncated: false };
  return { value: 0, found: false, truncated: result.rows.length >= SERVER_ROW_CAP };
}

export async function gscCompare(
  client: GscPager,
  params: GscCompareParams,
): Promise<GscCompareResult> {
  const common = {
    site: params.site,
    dimension: "query" as const,
    metric: params.metric,
    brandedQueries: params.brandedQueries,
    filters: params.filters,
  };
  const [current, prior] = await Promise.all([
    findQueryMetric(
      client,
      { ...common, startDate: params.currentStart, endDate: params.currentEnd },
      params.query,
    ),
    findQueryMetric(
      client,
      { ...common, startDate: params.compareStart, endDate: params.compareEnd },
      params.query,
    ),
  ]);
  const delta = current.value - prior.value;
  return {
    label: params.query,
    current: current.value,
    prior: prior.value,
    delta_abs: delta,
    delta_pct: prior.value === 0 ? null : (delta / prior.value) * 100,
    found: current.found || prior.found,
    found_current: current.found,
    found_prior: prior.found,
    truncated: current.truncated || prior.truncated,
  };
}
