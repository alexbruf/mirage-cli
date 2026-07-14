export type Format = "json" | "jsonl" | "table" | "csv" | "text";
export const FORMATS: readonly Format[] = ["json", "jsonl", "table", "csv", "text"];

const MAX_CELL = 72;

export function parseFormat(raw: string | undefined): Format {
  const format = (raw ?? "json") as Format;
  if (!FORMATS.includes(format)) {
    throw new Error(`Unknown format "${raw}". Formats: ${FORMATS.join(", ")}`);
  }
  return format;
}

export function renderList(envelope: unknown, rows: unknown[], format: Format): string {
  if (format === "json") return JSON.stringify(envelope, null, 2);
  if (format === "jsonl") return rows.map((row) => JSON.stringify(row)).join("\n");
  if (format === "csv") return toCsv(rows);
  if (format === "table") return toTable(rows);
  return rows.map((row) => stringify(row)).join("\n");
}

export function renderObject(value: unknown, format: Format): string {
  if (format === "json") return JSON.stringify(value, null, 2);
  if (format === "jsonl") return JSON.stringify(value);
  if (format === "csv") return toCsv([value]);
  if (format === "table" && isRecord(value)) {
    return toTable(
      Object.entries(value).map(([field, fieldValue]) => ({ field, value: stringify(fieldValue) })),
    );
  }
  return stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function columns(rows: unknown[]): string[] {
  const result = new Set<string>();
  for (const row of rows) {
    if (isRecord(row)) for (const key of Object.keys(row)) result.add(key);
  }
  return [...result];
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function truncate(value: string): string {
  return value.length > MAX_CELL ? `${value.slice(0, MAX_CELL - 3)}...` : value;
}

function toTable(rows: unknown[]): string {
  if (rows.length === 0) return "(no rows)";
  const cols = columns(rows);
  if (cols.length === 0) return rows.map(stringify).join("\n");
  const cells = rows.map((row) =>
    cols.map((column) => truncate(stringify((row as Record<string, unknown>)[column]))),
  );
  const widths = cols.map((column, index) =>
    Math.max(column.length, ...cells.map((row) => row[index]?.length ?? 0)),
  );
  const line = (row: string[]) =>
    row.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join("  ");
  return [line(cols), widths.map((width) => "-".repeat(width)).join("  "), ...cells.map(line)].join(
    "\n",
  );
}

function toCsv(rows: unknown[]): string {
  if (rows.length === 0) return "";
  const cols = columns(rows);
  const escape = (value: unknown) => {
    const text = stringify(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    cols.map(escape).join(","),
    ...rows.map((row) =>
      cols.map((column) => escape((row as Record<string, unknown>)[column])).join(","),
    ),
  ].join("\n");
}
