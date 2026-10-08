/**
 * Output formatting and file export for the looker CLI.
 *
 * Every command produces one JSON value. `--format json` (default) prints it
 * whole; `csv` and `ndjson` print a table of rows picked from it. Each command
 * can name its natural rows (a dot path or an extractor); `--rows <path>`
 * overrides that, and with neither the largest array of objects at the top
 * level or under `report` is used. `--output <path>` writes the text to a file
 * (through Mirage's VFS bridge when present, else node:fs) and prints a short
 * summary instead.
 */

export const FORMATS = ["json", "csv", "ndjson"] as const;
export type Format = (typeof FORMATS)[number];

export type RowExtractor = (value: unknown) => unknown[];
export type RowSpec = string | { label: string; extract: RowExtractor };

export interface RenderOptions {
  format: Format;
  pretty?: boolean;
  /** `--rows` from the command line; wins over the command's default. */
  rowsPath?: string;
  /** The command's natural rows. */
  defaultRows?: RowSpec;
}

export interface Rendered {
  text: string;
  /** Row count when a table was produced. */
  rows: number | null;
  /** Where the rows came from (a dot path or an extractor label). */
  rowsFrom: string | null;
}

export function parseFormat(value: string | undefined): Format {
  const format = (value ?? "json").toLowerCase();
  if (!(FORMATS as readonly string[]).includes(format)) {
    throw new Error(`--format must be one of ${FORMATS.join(", ")}; got ${JSON.stringify(value)}`);
  }
  return format as Format;
}

export function render(value: unknown, options: RenderOptions): Rendered {
  const { format } = options;
  if (format === "json" && options.rowsPath === undefined) {
    return { text: JSON.stringify(value, null, options.pretty ? 2 : undefined) + "\n", rows: null, rowsFrom: null };
  }
  const { rows, from } = selectRows(value, options.rowsPath, options.defaultRows);
  if (format === "json") {
    return { text: JSON.stringify(rows, null, options.pretty ? 2 : undefined) + "\n", rows: rows.length, rowsFrom: from };
  }
  if (format === "ndjson") {
    return { text: rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), rows: rows.length, rowsFrom: from };
  }
  return { text: toCsv(rows), rows: rows.length, rowsFrom: from };
}

export function selectRows(
  value: unknown,
  rowsPath: string | undefined,
  defaultRows: RowSpec | undefined,
): { rows: unknown[]; from: string } {
  if (rowsPath !== undefined) return { rows: asRows(atPath(value, rowsPath)), from: rowsPath };
  if (typeof defaultRows === "string") return { rows: asRows(atPath(value, defaultRows)), from: defaultRows };
  if (defaultRows) return { rows: defaultRows.extract(value), from: defaultRows.label };
  if (Array.isArray(value)) return { rows: value, from: "." };
  const found = largestTable(value);
  if (found) return { rows: found.rows, from: found.path };
  return { rows: value === null || value === undefined ? [] : [value], from: "." };
}

/**
 * Resolve a dot path. `.` is the whole value. Arrays met along the way are
 * flattened, so `series.points` returns every point of every series.
 */
export function atPath(value: unknown, path: string): unknown {
  if (path === "." || path === "") return value;
  let current: unknown[] = [value];
  let flattened = false;
  for (const key of path.split(".").filter(Boolean)) {
    const next: unknown[] = [];
    for (const item of current) {
      if (Array.isArray(item)) {
        flattened = true;
        for (const element of item) next.push(getKey(element, key));
      } else {
        next.push(getKey(item, key));
      }
    }
    current = next;
  }
  if (!flattened) return current[0];
  return current.flatMap((item) => (Array.isArray(item) ? item : item === undefined ? [] : [item]));
}

function getKey(value: unknown, key: string): unknown {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function asRows(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function largestTable(value: unknown): { rows: unknown[]; path: string } | null {
  if (!value || typeof value !== "object") return null;
  let best: { rows: unknown[]; path: string } | null = null;
  const consider = (container: unknown, prefix: string) => {
    if (!container || typeof container !== "object" || Array.isArray(container)) return;
    for (const [key, candidate] of Object.entries(container)) {
      if (!Array.isArray(candidate) || candidate.length === 0) continue;
      if (!candidate.every((item) => item && typeof item === "object" && !Array.isArray(item))) continue;
      if (!best || candidate.length > best.rows.length) best = { rows: candidate, path: prefix + key };
    }
  };
  consider(value, "");
  consider((value as Record<string, unknown>).report, "report.");
  return best;
}

/** RFC 4180 CSV with a header row; nested objects flatten to dotted columns. */
export function toCsv(rows: readonly unknown[]): string {
  const flat = rows.map((row) => flatten(row));
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of flat) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  if (columns.length === 0) return "";
  const lines = [columns.map(csvCell).join(",")];
  for (const row of flat) lines.push(columns.map((column) => csvCell(row[column] ?? "")).join(","));
  return lines.join("\n") + "\n";
}

function flatten(value: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (value === null || value === undefined) {
    if (prefix) out[prefix] = "";
    return out;
  }
  if (Array.isArray(value)) {
    const primitive = value.every((item) => item === null || typeof item !== "object");
    out[prefix || "value"] = primitive
      ? value.map((item) => (item === null || item === undefined ? "" : String(item))).join("|")
      : JSON.stringify(value);
    return out;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0 && prefix) out[prefix] = "";
    for (const [key, child] of entries) flatten(child, prefix ? `${prefix}.${key}` : key, out);
    return out;
  }
  out[prefix || "value"] = String(value);
  return out;
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

interface MirageFileIoBridge {
  canHandle?(path: unknown): boolean;
  writeFileSync?(path: unknown, data: unknown, options?: unknown): boolean;
}

/**
 * Write through Mirage's VFS bridge when present (so /sessions and /data paths
 * land in the workspace), then fall back to node:fs, imported lazily so a
 * Worker never needs it.
 */
export async function writeOutput(path: string, text: string): Promise<number> {
  const bytes = new TextEncoder().encode(text);
  const bridge = (globalThis as typeof globalThis & { __MIRAGE_CLI_FILE_IO__?: MirageFileIoBridge })
    .__MIRAGE_CLI_FILE_IO__;
  if (bridge?.canHandle?.(path)) {
    if (bridge.writeFileSync?.(path, bytes)) return bytes.byteLength;
    throw new Error(`Mirage VFS could not write ${path}`);
  }
  const [{ dirname }, { mkdirSync, writeFileSync }] = await Promise.all([
    import("node:path"),
    import("node:fs"),
  ]);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return bytes.byteLength;
}

// ── Row extractors for responses whose natural table is not one array ──────

/** `keywords history`: one row per check, tagged with its series. */
export const historyRows: RowSpec = {
  label: "series[].points",
  extract: (value) => {
    const record = (value ?? {}) as { keyword?: unknown; series?: Array<{ label?: unknown; isTarget?: unknown; points?: unknown[] }> };
    return (record.series ?? []).flatMap((series) =>
      (series.points ?? []).map((point) => ({
        keyword: record.keyword,
        series: series.label,
        isTarget: series.isTarget,
        ...(point as object),
      })),
    );
  },
};

/** `gsc performance`: name each `keys[i]` after `dimensions[i]`. */
export const gscRows: RowSpec = {
  label: "rows",
  extract: (value) => {
    const record = (value ?? {}) as { dimensions?: string[]; rows?: Array<{ keys?: unknown[] } & Record<string, unknown>> };
    const dimensions = record.dimensions ?? [];
    return (record.rows ?? []).map(({ keys, ...metrics }) => ({
      ...Object.fromEntries(dimensions.map((dimension, i) => [dimension, keys?.[i]])),
      ...metrics,
    }));
  },
};

/** `changes`: every list in the diff feed, tagged with its section. */
export const changesRows: RowSpec = {
  label: "changes",
  extract: (value) => {
    const record = (value ?? {}) as Record<string, unknown>;
    const sections: Array<[string, unknown]> = [
      ["improved", atPath(record, "rankMovers.improved")],
      ["declined", atPath(record, "rankMovers.declined")],
      ["entered_top10", atPath(record, "top10.entered")],
      ["left_top10", atPath(record, "top10.left")],
      ["aio_gained", atPath(record, "aio.gained")],
      ["aio_lost", atPath(record, "aio.lost")],
      ["new_keyword", atPath(record, "newKeywords.items")],
      ["audit", atPath(record, "audits.items")],
      ["analysis", atPath(record, "analyses.items")],
    ];
    return sections.flatMap(([section, items]) =>
      asRows(items).map((item) => ({ section, ...(item && typeof item === "object" ? item : { value: item }) })),
    );
  },
};
