import { writeFileSync } from "node:fs";

export type Format = "ascii" | "json" | "csv" | "markdown" | "ndjson";

export interface OutputOpts {
  format?: Format | string;
  output?: string;
}

const MAX_CELL = 60;

export function writeOutput(rows: unknown[], opts: OutputOpts = {}): void {
  const format = (opts.format as Format) ?? "ascii";
  const text = renderOutput(rows, format);
  emit(text, opts.output);
}

export function writeObject(obj: unknown, opts: OutputOpts = {}): void {
  const format = (opts.format as Format) ?? "ascii";
  if (format === "json" || format === "ndjson") {
    emit(JSON.stringify(obj, null, 2), opts.output);
    return;
  }
  if (Array.isArray(obj)) {
    emit(renderOutput(obj, format), opts.output);
    return;
  }
  if (obj && typeof obj === "object") {
    const rows = Object.entries(obj as Record<string, unknown>).map(([field, value]) => ({
      field,
      value: stringify(value),
    }));
    emit(renderOutput(rows, format), opts.output);
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

export function renderOutput(rows: unknown[], format: Format): string {
  switch (format) {
    case "json":
      return JSON.stringify(rows, null, 2);
    case "ndjson":
      return rows.map((r) => JSON.stringify(r)).join("\n");
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
    if (row && typeof row === "object" && !Array.isArray(row)) {
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
  if (cols.length === 0) {
    // Scalars
    return rows.map(stringify).join("\n");
  }
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
