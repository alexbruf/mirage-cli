import { Command, Option as CommanderOption } from "commander";
import {
  CommandSpec,
  IOResult,
  OperandKind,
  Option,
  type ByteSource,
} from "./types.ts";

export type CommandOpts = {
  flags: Record<string, string | boolean>;
  stdin?: ByteSource | null;
  [k: string]: unknown;
};
export type CommandFnResult = [ByteSource | null, IOResult] | null;
export type CommandFn = (
  accessor: unknown,
  paths: readonly string[],
  texts: readonly string[],
  opts: CommandOpts,
) => Promise<CommandFnResult> | CommandFnResult;

export interface CommandDef {
  readonly name: string;
  readonly resource: string | string[] | null;
  readonly spec: CommandSpec;
  readonly fn: CommandFn;
  readonly description: string | null;
  /** Verbose help block printed after the standard usage (Columns / Filters / Example). */
  readonly longHelp?: string;
}

export function command(init: {
  name: string;
  resource?: string | string[] | null;
  spec: CommandSpec;
  fn: CommandFn;
  description?: string;
  longHelp?: string;
}): CommandDef {
  return Object.freeze({
    name: init.name,
    resource: init.resource ?? null,
    spec: init.spec,
    fn: init.fn,
    description: init.description ?? init.spec.description ?? null,
    longHelp: init.longHelp,
  });
}

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

// ---------------------------------------------------------------- invoke()

const DEC = new TextDecoder();

export interface InvokeInput {
  paths?: readonly string[];
  texts?: readonly string[];
  flags?: Record<string, string | boolean>;
}

export async function invoke(
  cmd: CommandDef,
  input: InvokeInput | readonly string[] = {},
): Promise<{ bytes: Uint8Array; text: string; result: IOResult }> {
  const structured = Array.isArray(input)
    ? argvToInput(cmd.spec, input)
    : (input as InvokeInput);
  const opts: CommandOpts = { flags: structured.flags ?? {} };
  const result = await cmd.fn(
    {},
    structured.paths ?? [],
    structured.texts ?? [],
    opts,
  );
  const [stdoutSrc, io] = result ?? [null, new IOResult()];
  const bytes =
    stdoutSrc instanceof Uint8Array
      ? stdoutSrc
      : (io.stdout ?? new Uint8Array());
  return { bytes, text: DEC.decode(bytes), result: io };
}

// ---------------------------------------------------------------- argv parser

export function argvToInput(
  spec: CommandSpec,
  argv: readonly string[],
): InvokeInput {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  // Seed defaults
  for (const opt of spec.options) {
    if (opt.defaultValue !== null) flags[opt.name] = opt.defaultValue;
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
    const name = tok.slice(2).split("=")[0]!;
    return spec.options.find((o) => o.long === name) as Option | undefined;
  }
  if (tok.startsWith("-") && tok.length > 1) {
    const ch = tok[1]!;
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

function splitPositional(
  spec: CommandSpec,
  vals: string[],
): { paths: string[]; texts: string[] } {
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
    pushByKind(op.kind, [vals[cursor]!], paths, texts);
    cursor += 1;
  }
  if (cursor < vals.length && spec.rest) {
    pushByKind(spec.rest.kind, vals.slice(cursor), paths, texts);
  }
  return { paths, texts };
}

function pushByKind(
  kind: OperandKind,
  vals: string[],
  paths: string[],
  texts: string[],
): void {
  if (kind === OperandKind.PATH) paths.push(...vals);
  else if (kind === OperandKind.TEXT) texts.push(...vals);
}

// ---------------------------------------------------------------- toCommander()

export function toCommander(cmd: CommandDef): Command {
  const c = new Command(cmd.name);
  if (cmd.description) c.description(cmd.description);

  for (const op of cmd.spec.positional) {
    const label = op.variadic
      ? `<${op.name}...>`
      : op.required
        ? `<${op.name}>`
        : `[${op.name}]`;
    c.argument(label);
  }
  if (cmd.spec.rest) c.argument(`[${cmd.spec.rest.name}...]`);
  for (const o of cmd.spec.options) c.addOption(toCommanderOption(o as Option));

  if (cmd.longHelp) {
    c.addHelpText("after", "\n" + cmd.longHelp);
  }

  c.action(async (...rawArgs: unknown[]) => {
    const opts = rawArgs[rawArgs.length - 2] as Record<string, unknown>;
    const positionals = rawArgs.slice(0, -2);

    const paths: string[] = [];
    const texts: string[] = [];
    cmd.spec.positional.forEach((op, idx) => {
      const v = positionals[idx];
      if (v == null) return;
      const arr = Array.isArray(v) ? (v as string[]) : [String(v)];
      pushByKind(op.kind, arr, paths, texts);
    });

    const flags: Record<string, string | boolean> = {};
    for (const opt of cmd.spec.options) {
      const o = opt as Option;
      const key = camel(o.long ?? o.short ?? "");
      if (key in opts) {
        const v = opts[key];
        if (typeof v === "string" || typeof v === "boolean") flags[o.name] = v;
      }
    }

    const result = await cmd.fn({}, paths, texts, { flags });
    const [stdoutSrc, io] = result ?? [null, new IOResult()];
    const stdout =
      stdoutSrc instanceof Uint8Array
        ? stdoutSrc
        : (io.stdout ?? new Uint8Array());
    if (stdout.byteLength > 0) process.stdout.write(stdout);
    if (io.stderr) process.stderr.write(io.stderr);
    if (io.exitCode !== 0) process.exit(io.exitCode);
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

function toCommanderOption(o: Option): CommanderOption {
  const parts: string[] = [];
  if (o.short) parts.push(`-${o.short}`);
  if (o.long) parts.push(`--${o.long}`);
  let flagStr = parts.join(", ");
  if (o.valueKind !== OperandKind.NONE) flagStr += ` <${o.long ?? o.short}>`;

  const co = new CommanderOption(flagStr, o.description ?? undefined);
  if (o.defaultValue !== null) co.default(o.defaultValue);
  if (o.required) co.makeOptionMandatory(true);
  return co;
}

function camel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function ok(
  body: string | Uint8Array,
  init: { exitCode?: number; stderr?: string } = {},
): CommandFnResult {
  const stdout =
    typeof body === "string" ? new TextEncoder().encode(body) : body;
  return [
    stdout,
    new IOResult({
      exitCode: init.exitCode ?? 0,
      stderr: init.stderr ?? null,
    }),
  ];
}
