/**
 * Output rendering. Default is `json` (raw API envelope — this CLI's primary
 * consumer is an LLM driver / jq pipeline); `jsonl` streams one record per
 * line, `table` and `csv` flatten the records array for humans/spreadsheets.
 */

export type Format = "json" | "jsonl" | "table" | "csv";

export const FORMATS: readonly Format[] = ["json", "jsonl", "table", "csv"];

const MAX_CELL = 60;

export function parseFormat(raw: string | undefined): Format {
  const format = (raw ?? "json") as Format;
  if (!FORMATS.includes(format)) {
    throw new Error(`Unknown format "${raw}". Formats: ${FORMATS.join(", ")}`);
  }
  return format;
}

/** Render a list response: `records` for row formats, `envelope` for json. */
export function renderList(envelope: unknown, records: unknown[], format: Format): string {
  switch (format) {
    case "json":
      return JSON.stringify(envelope, null, 2);
    case "jsonl":
      return records.map((r) => JSON.stringify(r)).join("\n");
    case "csv":
      return toCsv(records);
    case "table":
      return toTable(records);
  }
}

/** Render a single object (detail responses, summaries). */
export function renderObject(obj: unknown, format: Format): string {
  switch (format) {
    case "json":
      return JSON.stringify(obj, null, 2);
    case "jsonl":
      return JSON.stringify(obj);
    case "csv":
      return toCsv([obj]);
    case "table": {
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        const rows = Object.entries(obj as Record<string, unknown>).map(([field, value]) => ({
          field,
          value: stringify(value),
        }));
        return toTable(rows);
      }
      return String(obj);
    }
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

function toTable(rows: unknown[]): string {
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
