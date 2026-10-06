import type { Row } from "./client.ts";

export type Format = "table" | "json" | "jsonl" | "csv";

const FORMATS: readonly Format[] = ["table", "json", "jsonl", "csv"];

/** Widest a table cell gets before it is cut; json/jsonl/csv are never cut. */
const MAX_CELL = 80;

export function parseFormat(value: string): Format {
  if ((FORMATS as readonly string[]).includes(value)) return value as Format;
  throw new Error(`Invalid --format "${value}". Use one of: ${FORMATS.join(", ")}.`);
}

export function render(rows: Row[], format: Format): string {
  if (format === "json") return JSON.stringify(rows, null, 2);
  if (format === "jsonl") return rows.map((r) => JSON.stringify(r)).join("\n");
  if (format === "csv") return toCSV(rows);
  return toTable(rows);
}

function columns(rows: Row[]): string[] {
  const cols = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) cols.add(k);
  return [...cols];
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function toCSV(rows: Row[]): string {
  if (!rows.length) return "";
  const cols = columns(rows);
  const esc = (v: unknown) => {
    const s = cell(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

function toTable(rows: Row[]): string {
  if (!rows.length) return "(no rows)";
  const cols = columns(rows);
  const short = (v: unknown) => {
    const s = cell(v).replace(/\s+/g, " ");
    return s.length > MAX_CELL ? `${s.slice(0, MAX_CELL - 1)}…` : s;
  };
  const grid = rows.map((r) => cols.map((c) => short(r[c])));
  const widths = cols.map((c, i) => Math.max(c.length, ...grid.map((g) => g[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  return [line(cols), sep, ...grid.map(line)].join("\n");
}
