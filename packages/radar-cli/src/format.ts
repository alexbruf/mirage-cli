/**
 * Output formatting for the metrics/export CLI commands: json (script-friendly),
 * table (human default for analytics), csv (spreadsheet-ready, RFC 4180).
 * The pre-existing entity commands keep their raw-JSON output untouched.
 */

export type OutputFormat = "json" | "table" | "csv";

export function parseFormat(v: string | undefined, fallback: OutputFormat): OutputFormat {
  if (v === "json" || v === "table" || v === "csv") return v;
  if (v) {
    console.error(`Unknown --format "${v}" (expected json|table|csv)`);
    process.exit(1);
  }
  return fallback;
}

/** Flat row for table/csv output — values render via String() (null → ""). */
export type FlatRow = Record<string, unknown>;

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(1);
  return String(v);
}

function csvEscape(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: FlatRow[], columns?: string[]): string {
  if (rows.length === 0) return "";
  const cols = columns ?? Object.keys(rows[0] ?? {});
  const lines = [cols.map(csvEscape).join(",")];
  for (const r of rows) lines.push(cols.map((c) => csvEscape(cell(r[c]))).join(","));
  return lines.join("\n");
}

export function toTable(rows: FlatRow[], columns?: string[]): string {
  if (rows.length === 0) return "(no rows)";
  const cols = columns ?? Object.keys(rows[0] ?? {});
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => cell(r[c]).length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(widths[i] ?? 0)).join("  ");
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  return [line(cols), sep, ...rows.map((r) => line(cols.map((c) => cell(r[c]))))].join("\n");
}

/**
 * Print tabular data in the chosen format. `json` prints the FULL original
 * payload (not just the flattened rows) so scripts lose nothing; table/csv
 * print the flattened rows with an optional fixed column order.
 */
export function printRows(
  fullPayload: unknown,
  rows: FlatRow[],
  format: OutputFormat,
  columns?: string[],
): void {
  if (format === "json") console.log(JSON.stringify(fullPayload, null, 2));
  else if (format === "csv") console.log(toCsv(rows, columns));
  else console.log(toTable(rows, columns));
}
