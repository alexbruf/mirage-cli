/**
 * Shared option mixins (`OUTPUT_OPTIONS`, `LOC_LANG_OPTIONS`) and the
 * `applyOutput()` helper that every data command uses to render its
 * DfsResponse into bytes + IOResult per the user's --output/--columns/etc.
 */
import type { DfsResponse } from "../lib/client.ts";
import { render, type OutputFormat } from "../lib/output.ts";
import type { CommandFnResult, CommandOpts } from "./runtime.ts";
import { IOResult, Operand, OperandKind, Option } from "./types.ts";

const ENC = new TextEncoder();

export const OUTPUT_OPTIONS: readonly Option[] = Object.freeze([
  new Option({
    short: "o",
    long: "output",
    valueKind: OperandKind.TEXT,
    description: "Output format: json|ndjson|table|csv|raw (default json).",
    defaultValue: "json",
  }),
  new Option({
    long: "columns",
    valueKind: OperandKind.TEXT,
    description: "Comma-separated columns for table/csv output.",
  }),
  new Option({
    long: "full",
    valueKind: OperandKind.NONE,
    description: "Emit the full response (skip the items extraction).",
  }),
  new Option({
    long: "no-cost",
    valueKind: OperandKind.NONE,
    description: "Don't print the response cost on stderr.",
  }),
]);

export function applyOutput(resp: DfsResponse, opts: CommandOpts): CommandFnResult {
  const flags = opts.flags ?? {};
  const format = (flags.output as OutputFormat) ?? "json";
  const full = flags.full === true;
  const noCost = flags["no-cost"] === true;
  const colsRaw = flags.columns;
  const columns =
    typeof colsRaw === "string"
      ? colsRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

  const text = render(resp, { format, full, columns });
  const stdout = ENC.encode(text.endsWith("\n") ? text : text + "\n");
  const stderr =
    !noCost && typeof resp.cost === "number" && resp.cost > 0
      ? `[cost] $${resp.cost.toFixed(4)}\n`
      : null;

  return [stdout, new IOResult({ exitCode: 0, stderr })];
}

export const LOC_LANG_OPTIONS: readonly Option[] = Object.freeze([
  new Option({
    long: "location",
    valueKind: OperandKind.TEXT,
    description: 'Location name (default "United States").',
    defaultValue: "United States",
  }),
  new Option({
    long: "location-code",
    valueKind: OperandKind.TEXT,
    description: "Location code, overrides --location.",
  }),
  new Option({
    long: "language",
    valueKind: OperandKind.TEXT,
    description: 'Language name (default "English").',
    defaultValue: "English",
  }),
  new Option({
    long: "language-code",
    valueKind: OperandKind.TEXT,
    description: "Language code, overrides --language.",
  }),
]);

export interface LocLangResolved {
  locationName?: string;
  locationCode?: number;
  languageName?: string;
  languageCode?: string;
}

export function resolveLocLang(opts: CommandOpts): LocLangResolved {
  const flags = opts.flags ?? {};
  const out: LocLangResolved = {};
  const locCode = flags["location-code"];
  if (typeof locCode === "string" && locCode) out.locationCode = Number(locCode);
  else out.locationName = (flags.location as string | undefined) ?? "United States";

  const langCode = flags["language-code"];
  if (typeof langCode === "string" && langCode) out.languageCode = langCode;
  else out.languageName = (flags.language as string | undefined) ?? "English";

  return out;
}

export function textOp(name: string, opts: { variadic?: boolean; required?: boolean } = {}): Operand {
  return new Operand({ kind: OperandKind.TEXT, name, ...opts });
}

export function flagStr(opts: CommandOpts, key: string, fallback?: string): string {
  const v = opts.flags?.[key];
  return typeof v === "string" ? v : (fallback ?? "");
}

export function flagBool(opts: CommandOpts, key: string): boolean {
  return opts.flags?.[key] === true;
}

export function flagNum(opts: CommandOpts, key: string, fallback: number): number {
  const v = opts.flags?.[key];
  if (typeof v === "string" && v) return Number(v);
  return fallback;
}
