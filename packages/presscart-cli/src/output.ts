import { writeFileSync } from "node:fs";

export type Format = "ascii" | "json" | "csv" | "markdown";

export interface OutputOpts {
  format?: Format | string;
  output?: string;
}

/**
 * Unwrap a Presscart list response. The API returns `{ records, total_records,
 * total_pages, ... }` for paginated lists and `{ <name>: [...] }` for the
 * locations endpoints. Falls back to common alternative keys and finally to an
 * empty array. Pass extra keys to check if a specific endpoint uses something
 * unusual.
 */
export function unwrapList(res: unknown, extraKeys: readonly string[] = []): unknown[] {
  if (Array.isArray(res)) return res;
  if (res && typeof res === "object") {
    const obj = res as Record<string, unknown>;
    for (const key of ["records", "data", ...extraKeys]) {
      const v = obj[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

export interface PriceFilterOpts {
  minPrice?: number;
  maxPrice?: number;
}

/**
 * Lowest `unit_amount` across a marketplace row's `prices[]`, in whole US
 * dollars. IMPORTANT: Presscart's `unit_amount` is whole USD, NOT Stripe cents
 * (e.g. Apple News carries `unit_amount: 775`, meaning $775, not $7.75).
 * Returns undefined when the row has no numeric price.
 */
export function rowPriceUsd(row: unknown): number | undefined {
  if (!row || typeof row !== "object") return undefined;
  const prices = (row as { prices?: unknown }).prices;
  if (!Array.isArray(prices)) return undefined;
  const amounts = prices
    .map((p) =>
      p && typeof p === "object" ? (p as { unit_amount?: unknown }).unit_amount : undefined,
    )
    .filter((n): n is number => typeof n === "number");
  return amounts.length > 0 ? Math.min(...amounts) : undefined;
}

/**
 * Client-side budget filter over `prices[].unit_amount` (whole USD). Presscart
 * exposes no server-side price filter, so the CLI fetches the page and filters
 * here. Note this filters only the rows on the current page — paginate with
 * `--page`/`--limit` to budget-filter the whole catalog. Rows with no price are
 * excluded whenever a bound is set (they can't be shown to satisfy a budget).
 */
export function filterByPrice(rows: unknown[], opts: PriceFilterOpts): unknown[] {
  const { minPrice, maxPrice } = opts;
  if (minPrice === undefined && maxPrice === undefined) return rows;
  return rows.filter((row) => {
    const price = rowPriceUsd(row);
    if (price === undefined) return false;
    if (minPrice !== undefined && price < minPrice) return false;
    if (maxPrice !== undefined && price > maxPrice) return false;
    return true;
  });
}

/** Pagination metadata Presscart returns alongside list `records`. */
export function listMeta(res: unknown): {
  totalRecords?: number;
  totalPages?: number;
  page?: number;
} {
  if (res && typeof res === "object") {
    const o = res as Record<string, unknown>;
    const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
    return {
      totalRecords: num(o.total_records),
      totalPages: num(o.total_pages),
      page: num(o.page) ?? num(o.current_page),
    };
  }
  return {};
}

/**
 * Write a marketplace list: unwrap records, apply the client-side price filter,
 * render to the chosen format on stdout, then print a one-line pagination/filter
 * summary to stderr. Data stays clean on stdout (safe to pipe/parse); the
 * summary tells callers when more pages exist so they don't mistake a single
 * default page (25 rows) for the whole catalog.
 */
export function writeList(
  res: unknown,
  unwrapKeys: readonly string[],
  opts: OutputOpts & PriceFilterOpts,
): void {
  const fetched = unwrapList(res, unwrapKeys);
  const shown = filterByPrice(fetched, opts);
  writeOutput(shown, opts);
  emitListSummary(res, fetched.length, shown.length);
}

function emitListSummary(res: unknown, fetched: number, shown: number): void {
  const meta = listMeta(res);
  const parts: string[] = [`${shown} shown`];
  if (shown !== fetched) parts.push(`(${fetched} fetched before price filter)`);
  if (meta.totalRecords !== undefined) {
    parts.push(`of ${meta.totalRecords} total`);
    if (meta.totalPages !== undefined && meta.totalPages > 1) {
      parts.push(`— page ${meta.page ?? "?"}/${meta.totalPages}, pass --page/--limit for more`);
    }
  }
  process.stderr.write(`# ${parts.join(" ")}\n`);
}

const MAX_CELL = 60;

export function writeOutput(rows: unknown[], opts: OutputOpts = {}): void {
  const format = (opts.format as Format) ?? "ascii";
  const text = render(rows, format);
  emit(text, opts.output);
}

export function writeObject(obj: unknown, opts: OutputOpts = {}): void {
  const format = (opts.format as Format) ?? "ascii";
  if (format === "json") {
    emit(JSON.stringify(obj, null, 2), opts.output);
    return;
  }
  if (obj && typeof obj === "object") {
    const rows = Object.entries(obj as Record<string, unknown>).map(([field, value]) => ({
      field,
      value: stringify(value),
    }));
    emit(render(rows, format), opts.output);
    return;
  }
  emit(String(obj), opts.output);
}

function emit(text: string, output?: string): void {
  if (output) {
    writeFileSync(output, text);
    console.log(`Wrote ${output}`);
  } else {
    process.stdout.write(`${text}\n`);
  }
}

function render(rows: unknown[], format: Format): string {
  switch (format) {
    case "json":
      return JSON.stringify(rows, null, 2);
    case "csv":
      return toCsv(rows);
    case "markdown":
      return toMarkdown(rows);
    default:
      return toAscii(rows);
  }
}

function getColumns(rows: unknown[]): string[] {
  const cols = new Set<string>();
  for (const row of rows) {
    if (row && typeof row === "object") {
      for (const k of Object.keys(row as object)) cols.add(k);
    }
  }
  return Array.from(cols);
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function truncate(s: string): string {
  return s.length > MAX_CELL ? `${s.slice(0, MAX_CELL - 3)}...` : s;
}

function toAscii(rows: unknown[]): string {
  if (rows.length === 0) return "(no rows)";
  const cols = getColumns(rows);
  const cells = rows.map((row) =>
    cols.map((c) => truncate(stringify((row as Record<string, unknown>)[c]))),
  );
  const widths = cols.map((c, i) => {
    let w = c.length;
    for (const r of cells) {
      const cell = r[i];
      if (cell !== undefined) w = Math.max(w, cell.length);
    }
    return w;
  });
  const pad = (r: string[]) => r.map((v, i) => v.padEnd(widths[i] ?? v.length)).join("  ");
  const header = pad(cols);
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  const body = cells.map(pad);
  return [header, sep, ...body].join("\n");
}

function toMarkdown(rows: unknown[]): string {
  if (rows.length === 0) return "_no rows_";
  const cols = getColumns(rows);
  const escapeCell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const header = `| ${cols.join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => {
    const values = cols.map((c) => escapeCell(stringify((row as Record<string, unknown>)[c])));
    return `| ${values.join(" | ")} |`;
  });
  return [header, sep, ...body].join("\n");
}

function toCsv(rows: unknown[]): string {
  if (rows.length === 0) return "";
  const cols = getColumns(rows);
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const header = cols.map(esc).join(",");
  const body = rows.map((row) =>
    cols.map((c) => esc(stringify((row as Record<string, unknown>)[c]))).join(","),
  );
  return [header, ...body].join("\n");
}
