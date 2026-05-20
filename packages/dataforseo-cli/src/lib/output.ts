import type { DfsResponse } from "./client.ts";
import { extractItems } from "./client.ts";

export type OutputFormat = "json" | "ndjson" | "table" | "csv" | "raw";

export type RenderOptions = {
  format: OutputFormat;
  /** When true, emit the full untouched response. Otherwise emit `extractItems(resp)`. */
  full?: boolean;
  /** Columns for table/csv. If omitted, derived from the first row. */
  columns?: string[];
};

export function render(resp: DfsResponse, opts: RenderOptions): string {
  if (opts.format === "raw") {
    return JSON.stringify(resp, null, 2);
  }

  const data: unknown = opts.full ? resp : extractItems(resp);

  switch (opts.format) {
    case "json":
      return JSON.stringify(data, null, 2);
    case "ndjson":
      return Array.isArray(data)
        ? data.map((r) => JSON.stringify(r)).join("\n")
        : JSON.stringify(data);
    case "table":
      return renderTable(asRows(data), opts.columns);
    case "csv":
      return renderCsv(asRows(data), opts.columns);
  }
}

export function emitCost(resp: DfsResponse): void {
  if (typeof resp.cost === "number" && resp.cost > 0) {
    process.stderr.write(`[cost] $${resp.cost.toFixed(4)}\n`);
  }
}

function asRows(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) {
    return data
      .filter((r): r is Record<string, unknown> => r !== null && typeof r === "object" && !Array.isArray(r));
  }
  if (data && typeof data === "object") return [data as Record<string, unknown>];
  return [];
}

function renderTable(rows: Array<Record<string, unknown>>, cols?: string[]): string {
  if (rows.length === 0) return "(no rows)";
  const columns = cols ?? deriveColumns(rows);
  const widths = columns.map((c) =>
    Math.max(c.length, ...rows.map((r) => fmtCell(r[c]).length)),
  );

  const lines: string[] = [];
  lines.push(columns.map((c, i) => c.padEnd(widths[i] ?? c.length)).join("  "));
  lines.push(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) {
    lines.push(columns.map((c, i) => fmtCell(row[c]).padEnd(widths[i] ?? 0)).join("  "));
  }
  return lines.join("\n");
}

function renderCsv(rows: Array<Record<string, unknown>>, cols?: string[]): string {
  if (rows.length === 0) return "";
  const columns = cols ?? deriveColumns(rows);
  const lines = [columns.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(fmtCell(row[c]))).join(","));
  }
  return lines.join("\n");
}

function deriveColumns(rows: Array<Record<string, unknown>>): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
  return [...seen];
}

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
