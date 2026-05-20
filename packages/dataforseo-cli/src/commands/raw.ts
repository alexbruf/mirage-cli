import { readFileSync } from "node:fs";
import {
  command,
  CommandSpec,
  IOResult,
  Operand,
  OperandKind,
  Option,
  type CommandDef,
  type CommandOpts,
} from "../framework/index.ts";
import { applyOutput, flagBool, flagStr, OUTPUT_OPTIONS, textOp } from "../framework/output.ts";
import { call, get, type DfsResponse } from "../lib/client.ts";
import { findEndpoint } from "../lib/spec.ts";

const RESOURCE = "ram";

export const rawCmd: CommandDef = command({
  name: "raw",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Hit any DataForSEO endpoint by path (escape hatch over the full 437-endpoint API).",
    positional: [textOp("path")],
    options: [
      new Option({ short: "d", long: "data", valueKind: OperandKind.TEXT, description: "Inline JSON body." }),
      new Option({ short: "f", long: "data-file", valueKind: OperandKind.TEXT, description: "Read JSON body from file. '-' for stdin." }),
      new Option({
        long: "kv",
        valueKind: OperandKind.TEXT,
        description: "Shorthand body fields, comma-separated, e.g. keyword=seo,location_code=2840.",
      }),
      new Option({ long: "example", valueKind: OperandKind.NONE, description: "Use the spec's example body." }),
      new Option({ long: "method", valueKind: OperandKind.TEXT, description: "Override HTTP method." }),
      new Option({ long: "no-wrap", valueKind: OperandKind.NONE, description: "Don't auto-wrap a single task as [task]." }),
      ...OUTPUT_OPTIONS,
    ],
    rest: new Operand({ kind: OperandKind.TEXT, name: "kvpairs" }),
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const path = texts[0] ?? "";
    if (!path) {
      return [null, new IOResult({ exitCode: 2, stderr: "raw: missing <path>\n" })];
    }
    const ep = findEndpoint(path);
    const methodOverride = flagStr(opts, "method");
    const method = (methodOverride || ep?.method || "post").toLowerCase();
    const body = await resolveBody(opts, ep?.example, texts.slice(1));

    let resp: DfsResponse;
    if (method === "get") resp = await get(path);
    else resp = await call(path, body, { wrapAsTaskArray: !flagBool(opts, "no-wrap") });
    return applyOutput(resp, opts);
  },
});

async function resolveBody(
  opts: CommandOpts,
  example: unknown,
  positionalKv: readonly string[],
): Promise<unknown> {
  if (flagBool(opts, "example")) {
    if (example === undefined) throw new Error("No example body in spec for this endpoint.");
    return example;
  }
  const data = flagStr(opts, "data");
  if (data) return JSON.parse(data);
  const file = flagStr(opts, "data-file");
  if (file) {
    const raw = file === "-" ? await readStdin() : readFileSync(file, "utf8");
    return JSON.parse(raw);
  }
  const kv = flagStr(opts, "kv");
  const pairs: string[] = [];
  if (kv) pairs.push(...kv.split(","));
  pairs.push(...positionalKv.filter((s) => s.includes("=")));
  if (pairs.length > 0) return parseKvPairs(pairs);
  return undefined;
}

function parseKvPairs(pairs: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of pairs) {
    const eq = p.indexOf("=");
    if (eq === -1) continue;
    out[p.slice(0, eq).trim()] = coerce(p.slice(eq + 1));
  }
  return out;
}

function coerce(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (/^-?\d*\.\d+$/.test(raw)) return Number(raw);
  if ((raw.startsWith("[") && raw.endsWith("]")) || (raw.startsWith("{") && raw.endsWith("}"))) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
