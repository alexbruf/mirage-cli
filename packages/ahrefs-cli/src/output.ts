import Table from "cli-table3";
import pc from "picocolors";

export type OutputFormat = "table" | "json" | "csv";

export interface RenderOpts {
  format: OutputFormat;
  columns?: string[];
  colorize?: (col: string, value: unknown) => string | undefined;
}

export function render(rows: Record<string, unknown>[], opts: RenderOpts): string {
  if (opts.format === "json") return JSON.stringify(rows, null, 2);

  const cols =
    opts.columns ?? (rows[0] ? Object.keys(rows[0]) : []);

  if (opts.format === "csv") {
    const head = cols.join(",");
    const body = rows
      .map((r) => cols.map((c) => csvCell(r[c])).join(","))
      .join("\n");
    return head + (body ? "\n" + body : "");
  }

  const table = new Table({
    head: cols.map((c) => pc.bold(c)),
    style: { head: [], border: ["gray"] },
  });
  for (const r of rows) {
    table.push(
      cols.map((c) => {
        const v = r[c];
        const formatted = formatCell(v);
        return opts.colorize ? (opts.colorize(c, v) ?? formatted) : formatted;
      }),
    );
  }
  return table.toString();
}

export function renderSingle(
  obj: Record<string, unknown>,
  opts: { format: OutputFormat },
): string {
  if (opts.format === "json") return JSON.stringify(obj, null, 2);
  if (opts.format === "csv") {
    const cols = Object.keys(obj);
    return cols.join(",") + "\n" + cols.map((c) => csvCell(obj[c])).join(",");
  }
  const table = new Table({
    style: { head: [], border: ["gray"] },
  });
  for (const [k, v] of Object.entries(obj)) {
    table.push({ [pc.bold(k)]: formatCell(v) });
  }
  return table.toString();
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return pc.dim("—");
  if (typeof v === "number") return v.toLocaleString();
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.length === 0 ? pc.dim("—") : `[${v.length}]`;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Visual bands for SEO metrics
export function colorizeMetric(col: string, value: unknown): string | undefined {
  if (typeof value !== "number") return undefined;
  if (col === "domain_rating" || col === "url_rating") {
    if (value >= 70) return pc.green(value.toString());
    if (value >= 40) return pc.yellow(value.toString());
    return pc.red(value.toString());
  }
  if (col === "difficulty" || col === "keyword_difficulty") {
    if (value >= 70) return pc.red(value.toString());
    if (value >= 40) return pc.yellow(value.toString());
    return pc.green(value.toString());
  }
  return undefined;
}
