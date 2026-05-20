import { Command, Option as CommanderOption } from "commander";
import {
  CommandSpec,
  IOResult,
  OperandKind,
  Option,
  type ByteSource,
} from "./types.ts";

/**
 * Mirage-compatible command function signature: (accessor, paths, texts, opts).
 * We use loose accessor/opts types since CLI commands typically don't touch
 * either. When registered into a real mirage workspace, mirage supplies the
 * concrete Accessor and CommandOpts.
 */
export type CommandOpts = {
  flags: Record<string, string | boolean>;
  stdin?: ByteSource | null;
  cwd?: string;
  resource?: unknown;
  [k: string]: unknown;
};

export type CommandFnResult = [ByteSource | null, IOResult] | null;
export type CommandFn = (
  accessor: unknown,
  paths: readonly string[],
  texts: readonly string[],
  opts: CommandOpts,
) => Promise<CommandFnResult> | CommandFnResult;

export interface CommandDefInit {
  name: string;
  /** Mirage's command() requires a resource ("ram", "s3", etc.) or null for general. */
  resource?: string | string[] | null;
  spec: CommandSpec;
  fn: CommandFn;
  /** Optional sugar — used if `spec.description` is null. */
  description?: string;
}

export interface CommandDef {
  readonly name: string;
  readonly resource: string | string[] | null;
  readonly spec: CommandSpec;
  readonly fn: CommandFn;
  readonly description: string | null;
}

/** Author a command. Same shape as @struktoai/mirage-core's `command()`. */
export function command(init: CommandDefInit): CommandDef {
  return Object.freeze({
    name: init.name,
    resource: init.resource ?? null,
    spec: init.spec,
    fn: init.fn,
    description: init.description ?? init.spec.description ?? null,
  });
}

/** Group commands under a namespace (CLI nesting). Mirage doesn't care about groups. */
export interface CommandGroup {
  readonly name: string;
  readonly description: string | null;
  readonly commands: readonly CommandDef[];
  readonly groups: readonly CommandGroup[];
}

export function group(init: {
  name: string;
  description?: string;
  commands?: readonly CommandDef[];
  groups?: readonly CommandGroup[];
}): CommandGroup {
  return Object.freeze({
    name: init.name,
    description: init.description ?? null,
    commands: Object.freeze([...(init.commands ?? [])]),
    groups: Object.freeze([...(init.groups ?? [])]),
  });
}

// ----------------------------------------------------------------------------
// Programmatic invocation
// ----------------------------------------------------------------------------

export interface InvokeInput {
  paths?: readonly string[];
  texts?: readonly string[];
  flags?: Record<string, string | boolean>;
  stdin?: ByteSource | null;
}

export interface InvokeResult {
  bytes: Uint8Array;
  text: string;
  result: IOResult;
}

const DEC = new TextDecoder();

/** Programmatically invoke a command. Pass argv tokens or a structured input. */
export async function invoke(cmd: CommandDef, input: InvokeInput | readonly string[] = {}): Promise<InvokeResult> {
  const structured: InvokeInput = Array.isArray(input) ? argvToInput(cmd.spec, input) : (input as InvokeInput);
  const opts: CommandOpts = {
    flags: structured.flags ?? {},
    stdin: structured.stdin ?? null,
  };
  const result = await cmd.fn({}, structured.paths ?? [], structured.texts ?? [], opts);
  const [stdoutSrc, io] = normalizeResult(result);
  const bytes = await toUint8Array(stdoutSrc ?? io.stdout);
  return { bytes, text: DEC.decode(bytes), result: io };
}

function normalizeResult(r: CommandFnResult): [ByteSource | null, IOResult] {
  if (!r) return [null, new IOResult()];
  return r;
}

async function toUint8Array(src: ByteSource | null): Promise<Uint8Array> {
  if (src === null) return new Uint8Array();
  if (src instanceof Uint8Array) return src;
  // AsyncIterable<Uint8Array>
  const chunks: Uint8Array[] = [];
  for await (const chunk of src) chunks.push(chunk);
  let len = 0;
  for (const c of chunks) len += c.byteLength;
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

// ----------------------------------------------------------------------------
// argv → InvokeInput (used by invoke() when called with a string[])
// ----------------------------------------------------------------------------

export function argvToInput(spec: CommandSpec, argv: readonly string[]): InvokeInput {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  // Seed defaults.
  for (const opt of spec.options) {
    if (opt.defaultValue !== null && opt.defaultValue !== undefined) flags[opt.name] = opt.defaultValue;
    else if (opt.valueKind === OperandKind.NONE) flags[opt.name] = false;
  }

  let i = 0;
  while (i < argv.length) {
    const tok = argv[i] ?? "";
    if (tok === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    const opt = matchOption(spec, tok);
    if (opt) {
      i += applyOption(opt, tok, argv, i, flags);
      continue;
    }
    positionals.push(tok);
    i += 1;
  }

  const { paths, texts } = splitPositional(spec, positionals);
  return { paths, texts, flags };
}

function matchOption(spec: CommandSpec, tok: string): Option | undefined {
  if (tok.startsWith("--")) {
    const name = tok.slice(2).split("=")[0];
    return spec.options.find((o) => o.long === name) as Option | undefined;
  }
  if (tok.startsWith("-") && tok.length > 1) {
    const ch = tok[1];
    return spec.options.find((o) => o.short === ch) as Option | undefined;
  }
  return undefined;
}

function applyOption(
  opt: Option,
  tok: string,
  argv: readonly string[],
  i: number,
  flags: Record<string, string | boolean>,
): number {
  if (opt.valueKind === OperandKind.NONE) {
    flags[opt.name] = true;
    return 1;
  }
  if (tok.includes("=")) {
    flags[opt.name] = tok.slice(tok.indexOf("=") + 1);
    return 1;
  }
  flags[opt.name] = argv[i + 1] ?? "";
  return 2;
}

function splitPositional(spec: CommandSpec, vals: string[]): { paths: string[]; texts: string[] } {
  const paths: string[] = [];
  const texts: string[] = [];
  let cursor = 0;

  for (const op of spec.positional) {
    if (cursor >= vals.length) break;
    if (op.variadic) {
      pushByKind(op.kind, vals.slice(cursor), paths, texts);
      cursor = vals.length;
      break;
    }
    pushByKind(op.kind, [vals[cursor] as string], paths, texts);
    cursor += 1;
  }
  if (cursor < vals.length && spec.rest) {
    pushByKind(spec.rest.kind, vals.slice(cursor), paths, texts);
  }
  return { paths, texts };
}

function pushByKind(kind: OperandKind, vals: string[], paths: string[], texts: string[]): void {
  if (kind === OperandKind.PATH) paths.push(...vals);
  else if (kind === OperandKind.TEXT) texts.push(...vals);
}

// ----------------------------------------------------------------------------
// Mount a command (or group) onto a commander program.
// ----------------------------------------------------------------------------

export function toCommander(cmd: CommandDef): Command {
  const c = new Command(cmd.name);
  if (cmd.description) c.description(cmd.description);
  applySpec(c, cmd.spec);

  c.action(async (...rawArgs: unknown[]) => {
    const cmdInstance = rawArgs[rawArgs.length - 1] as Command;
    const cmdOpts = rawArgs[rawArgs.length - 2] as Record<string, unknown>;
    const positionals = rawArgs.slice(0, -2);

    const { paths, texts, flags } = parseCommanderArgs(cmd.spec, positionals, cmdOpts);
    const result = await cmd.fn({}, paths, texts, { flags });
    const [stdoutSrc, io] = result ?? [null, new IOResult()];

    const stdout = await toUint8Array(stdoutSrc ?? io.stdout);
    if (stdout.byteLength > 0) process.stdout.write(stdout);
    if (io.stderr) process.stderr.write(io.stderr);
    if (io.exitCode !== 0) process.exit(io.exitCode);
    void cmdInstance;
  });
  return c;
}

export function mountGroup(parent: Command, g: CommandGroup): Command {
  const node = new Command(g.name);
  if (g.description) node.description(g.description);
  for (const sub of g.groups) mountGroup(node, sub);
  for (const c of g.commands) node.addCommand(toCommander(c));
  parent.addCommand(node);
  return node;
}

function applySpec(c: Command, spec: CommandSpec): void {
  for (const op of spec.positional) {
    const label = op.variadic ? `<${op.name}...>` : op.required ? `<${op.name}>` : `[${op.name}]`;
    c.argument(label);
  }
  if (spec.rest) c.argument(`[${spec.rest.name}...]`);
  for (const o of spec.options) c.addOption(toCommanderOption(o));
}

function toCommanderOption(o: Option): CommanderOption {
  const co = new CommanderOption(buildFlagString(o), o.description ?? undefined);
  if (o.defaultValue !== null) co.default(o.defaultValue);
  if (o.required) co.makeOptionMandatory(true);
  return co;
}

function buildFlagString(o: Option): string {
  const parts: string[] = [];
  if (o.short) parts.push(`-${o.short}`);
  if (o.long) parts.push(`--${o.long}`);
  let s = parts.join(", ");
  if (o.valueKind !== OperandKind.NONE) s += ` <${o.long ?? o.short}>`;
  return s;
}

function parseCommanderArgs(
  spec: CommandSpec,
  positionals: unknown[],
  cmdOpts: Record<string, unknown>,
): { paths: string[]; texts: string[]; flags: Record<string, string | boolean> } {
  const paths: string[] = [];
  const texts: string[] = [];
  spec.positional.forEach((op, idx) => {
    const v = positionals[idx];
    if (v === undefined || v === null) return;
    const arr = Array.isArray(v) ? (v as string[]) : [String(v)];
    pushByKind(op.kind, arr, paths, texts);
  });

  const flags: Record<string, string | boolean> = {};
  for (const opt of spec.options) {
    const key = camel(opt.long ?? opt.short ?? "");
    if (key in cmdOpts) {
      const val = cmdOpts[key];
      if (typeof val === "string" || typeof val === "boolean") flags[opt.name] = val;
    }
  }
  return { paths, texts, flags };
}

function camel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Convenience for command authors: wrap text/bytes as a CommandFnResult.
 *
 * `ok("hello")` → stdout="hello", exitCode=0
 * `ok(bytes, { exitCode: 1, stderr: "oops" })`
 */
export function ok(
  body: string | Uint8Array,
  init: { exitCode?: number; stderr?: string | Uint8Array } = {},
): CommandFnResult {
  const stdout = typeof body === "string" ? new TextEncoder().encode(body) : body;
  return [stdout, new IOResult({ exitCode: init.exitCode ?? 0, stderr: init.stderr ?? null })];
}
