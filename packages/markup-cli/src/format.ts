export type OutputFormat = "json" | "ndjson" | "table";

export function pickFmt(o: { json?: boolean; ndjson?: boolean }): OutputFormat {
  if (o.json) return "json";
  if (o.ndjson) return "ndjson";
  return "table";
}

/**
 * Write a result. `table` uses the row formatter when the command has one and
 * falls back to indented JSON otherwise, so every command prints something
 * readable without each one needing a bespoke layout.
 */
export function emit(value: unknown, fmt: OutputFormat, row?: (item: unknown) => string): void {
  const out = process.stdout;
  if (fmt === "json") {
    out.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  if (fmt === "ndjson") {
    for (const item of Array.isArray(value) ? value : [value]) out.write(`${JSON.stringify(item)}\n`);
    return;
  }
  if (row && Array.isArray(value)) {
    if (value.length === 0) out.write("(none)\n");
    for (const item of value) out.write(row(item));
    return;
  }
  if (row) {
    out.write(row(value));
    return;
  }
  out.write(typeof value === "string" ? `${value}\n` : `${JSON.stringify(value, null, 2)}\n`);
}
