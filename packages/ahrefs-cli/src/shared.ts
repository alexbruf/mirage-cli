import { Option, OperandKind } from "./framework/types.ts";
import type { CommandOpts } from "./framework/runtime.ts";
import type { OutputFormat } from "./output.ts";

/**
 * Options shared by every endpoint command. Each command's CommandSpec
 * spreads this array.
 */
export const globalOptions: readonly Option[] = Object.freeze([
  new Option({
    long: "json",
    description: "Output raw JSON (composable with jq).",
  }),
  new Option({
    long: "csv",
    description: "Output CSV (header row + rows).",
  }),
  new Option({
    long: "api-key",
    valueKind: OperandKind.TEXT,
    description: "Ahrefs API key. Defaults to $AHREFS_API_KEY.",
  }),
  new Option({
    long: "cache",
    valueKind: OperandKind.TEXT,
    description: "Cache GET responses for this duration (e.g. 1h, 30m, 1d).",
  }),
  new Option({
    long: "explain",
    description: "Print the equivalent curl to stderr before calling.",
  }),
  new Option({
    long: "help-short",
    description:
      "Compact help — flag table only, no column inventory or examples.",
  }),
]);

export const GLOBAL_OPTION_NAMES: ReadonlySet<string> = new Set(
  globalOptions.map((o) => o.name),
);

/** Pull a string flag from a parsed CommandOpts bag. */
export function str(opts: CommandOpts, key: string): string | undefined {
  const v = opts.flags[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function bool(opts: CommandOpts, key: string): boolean {
  return opts.flags[key] === true;
}

export function resolveFormat(opts: CommandOpts): OutputFormat {
  if (bool(opts, "json")) return "json";
  if (bool(opts, "csv")) return "csv";
  return "table";
}

export function parseDuration(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = /^(\d+)(s|m|h|d)$/.exec(s);
  if (!m) throw new Error(`Bad duration "${s}". Use eg 30s, 5m, 1h, 7d.`);
  const n = Number(m[1]);
  const unit = m[2] as "s" | "m" | "h" | "d";
  return n * { s: 1, m: 60, h: 3600, d: 86400 }[unit];
}

export function cacheTtl(opts: CommandOpts): number | undefined {
  return parseDuration(str(opts, "cache"));
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
