import type { Row } from "./sources/types.ts";

export type Format = "table" | "json" | "csv";

export function render(rows: Row[], format: Format): string {
  if (format === "json") return JSON.stringify(rows, null, 2);
  if (format === "csv") return toCSV(rows);
  return toTable(rows);
}

function columns(rows: Row[]): string[] {
  const cols = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) cols.add(k);
  return [...cols];
}

function cell(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

function toCSV(rows: Row[]): string {
  if (!rows.length) return "";
  const cols = columns(rows);
  const esc = (v: unknown) => {
    const s = cell(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

function toTable(rows: Row[]): string {
  if (!rows.length) return "(no rows)";
  const cols = columns(rows);
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => cell(r[c]).length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  return [line(cols), sep, ...rows.map((r) => line(cols.map((c) => cell(r[c]))))].join("\n");
}
