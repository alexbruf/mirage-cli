export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

// Unwraps the Microsoft MCP response envelope:
//   { content: [{ type: "text", text: "<JSON-or-prose>" }] }
// Returns parsed JSON if the inner text is JSON, otherwise the raw string.
function unwrap(value: unknown): unknown {
  if (value && typeof value === "object") {
    const v = value as any;
    if (Array.isArray(v.content)) {
      const texts = v.content
        .filter((c: any) => c?.type === "text" && typeof c.text === "string")
        .map((c: any) => c.text);
      const joined = texts.join("\n");
      try { return JSON.parse(joined); } catch { return joined; }
    }
  }
  return value;
}

function isArrayOfObjects(v: unknown): v is Array<Record<string, unknown>> {
  return Array.isArray(v) && v.length > 0 && v.every(
    (r) => r !== null && typeof r === "object" && !Array.isArray(r),
  );
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function formatTable(rows: Array<Record<string, unknown>>, columns?: string[]): string {
  if (rows.length === 0) return "(no results)";
  const cols = columns ?? Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => stringify(r[c]).length)),
  );
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));
  const sep = widths.map((w) => "─".repeat(w)).join("──");
  const lines: string[] = [];
  lines.push(cols.map((c, i) => pad(c, widths[i] ?? 0)).join("  "));
  lines.push(sep);
  for (const row of rows) {
    lines.push(cols.map((c, i) => pad(stringify(row[c]), widths[i] ?? 0)).join("  "));
  }
  return lines.join("\n");
}

export function formatCsv(value: unknown, columns?: string[]): string {
  const inner = unwrap(value);
  if (!isArrayOfObjects(inner)) {
    throw new Error(
      "CSV output requires a tabular response (array of objects). " +
      "This response isn't tabular — try --json or default text output.",
    );
  }
  const cols = columns ?? Array.from(new Set(inner.flatMap((r) => Object.keys(r))));
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = stringify(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [cols.join(",")];
  for (const row of inner) lines.push(cols.map((c) => esc(row[c])).join(","));
  return lines.join("\n");
}

// Default "text" renderer: unwraps the MCP envelope, auto-tables arrays of
// flat objects, falls back to prose or pretty-JSON for anything else.
export function formatText(value: unknown): string {
  const inner = unwrap(value);
  if (typeof inner === "string") return inner;
  if (isArrayOfObjects(inner)) return formatTable(inner);
  return formatJson(inner);
}

export function formatOutput(
  value: unknown,
  opts: { json?: boolean; csv?: boolean },
): string {
  if (opts.json) return formatJson(value);
  if (opts.csv) return formatCsv(value);
  return formatText(value);
}
