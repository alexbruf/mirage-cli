/**
 * Runtime classes that match @struktoai/mirage-core's shapes exactly, plus
 * a thin CLI-only extension (defaultValue, required, name, variadic) carried
 * on Option/Operand for commander adapter convenience.
 *
 * Type-only import from mirage-core: zero runtime dep, zero bundle bytes from
 * mirage; tsc enforces structural parity (mirage-side change → tsc error here).
 */
import type {
  Option as MOption,
  Operand as MOperand,
  CommandSpec as MCommandSpec,
  ParsedArgs as MParsedArgs,
  IOResult as MIOResult,
  OptionInit as MOptionInit,
  OperandInit as MOperandInit,
  CommandSpecInit as MCommandSpecInit,
  ParsedArgsInit as MParsedArgsInit,
  IOResultInit as MIOResultInit,
  OperandKind as MOperandKind,
  ByteSource,
} from "@struktoai/mirage-core";

export type { ByteSource };

export type OperandKind = MOperandKind;
export const OperandKind: Readonly<{ NONE: "none"; PATH: "path"; TEXT: "text" }> = Object.freeze({
  NONE: "none",
  PATH: "path",
  TEXT: "text",
});

/** Our CLI-extended OptionInit: mirage's fields + `defaultValue` and `required` for commander. */
export interface OptionInit extends MOptionInit {
  defaultValue?: string | boolean | null;
  required?: boolean;
}

export class Option implements MOption {
  readonly short: string | null;
  readonly long: string | null;
  readonly valueKind: OperandKind;
  readonly numericShorthand: boolean;
  readonly description: string | null;
  // CLI extensions — invisible to mirage's structural shape but used by toCommander().
  readonly defaultValue: string | boolean | null;
  readonly required: boolean;

  constructor(init: OptionInit = {}) {
    this.short = init.short ?? null;
    this.long = init.long ?? null;
    this.valueKind = init.valueKind ?? OperandKind.NONE;
    this.numericShorthand = init.numericShorthand ?? false;
    this.description = init.description ?? null;
    this.defaultValue = init.defaultValue ?? null;
    this.required = init.required ?? false;
    Object.freeze(this);
  }

  /** Stable identifier (kebab-case) for opts.flags lookup. */
  get name(): string {
    return this.long ?? this.short ?? "";
  }
}

/** Our CLI-extended OperandInit: mirage has only `kind`; we add `name`/`variadic`/`required`. */
export interface OperandInit extends MOperandInit {
  name?: string;
  variadic?: boolean;
  required?: boolean;
}

export class Operand implements MOperand {
  readonly kind: OperandKind;
  readonly name: string;
  readonly variadic: boolean;
  readonly required: boolean;

  constructor(init: OperandInit = {}) {
    this.kind = init.kind ?? OperandKind.PATH;
    this.name = init.name ?? "arg";
    this.variadic = init.variadic ?? false;
    this.required = init.required ?? true;
    Object.freeze(this);
  }
}

export type CommandSpecInit = MCommandSpecInit;
export class CommandSpec implements MCommandSpec {
  readonly options: readonly Option[];
  readonly positional: readonly Operand[];
  readonly rest: Operand | null;
  readonly ignoreTokens: ReadonlySet<string>;
  readonly description: string | null;

  constructor(init: CommandSpecInit = {}) {
    this.options = Object.freeze([...((init.options ?? []) as Option[])]);
    this.positional = Object.freeze([...((init.positional ?? []) as Operand[])]);
    this.rest = (init.rest as Operand | null | undefined) ?? null;
    this.ignoreTokens = new Set(init.ignoreTokens ?? []);
    this.description = init.description ?? null;
    Object.freeze(this);
  }
}

export type ParsedArgsInit = MParsedArgsInit;
export class ParsedArgs implements MParsedArgs {
  readonly flags: Record<string, string | boolean>;
  readonly args: [string, OperandKind][];
  readonly cachePaths: string[];
  readonly pathFlagValues: string[];

  constructor(init: ParsedArgsInit) {
    this.flags = init.flags;
    this.args = init.args;
    this.cachePaths = init.cachePaths ?? [];
    this.pathFlagValues = init.pathFlagValues ?? [];
  }

  paths(): string[] {
    return this.args.filter(([, k]) => k === OperandKind.PATH).map(([v]) => v);
  }

  routingPaths(): string[] {
    return [...this.paths(), ...this.pathFlagValues];
  }

  texts(): string[] {
    return this.args.filter(([, k]) => k === OperandKind.TEXT).map(([v]) => v);
  }

  flag(name: string, fallback: string | boolean | null = null): string | boolean | null {
    return this.flags[name] ?? fallback;
  }
}

/**
 * IOResult — partial implementation of mirage's class. We populate stdout /
 * stderr / exitCode; the streaming/reads/writes/cache surface is left at
 * defaults. Mirage uses these structurally, so missing methods are fine for
 * simple command outputs (we don't stream).
 */
export interface IOResultInit extends Omit<MIOResultInit, "stdout" | "stderr"> {
  /** Accepts either bytes or a UTF-8 string (auto-encoded). */
  stdout?: ByteSource | string | null;
  /** Accepts either bytes or a UTF-8 string (auto-encoded). */
  stderr?: ByteSource | string | null;
}

export class IOResult {
  stdout: Uint8Array | null;
  stderr: Uint8Array | null;
  exitCode: number;
  reads: Record<string, ByteSource>;
  writes: Record<string, ByteSource>;
  cache: string[];
  streamSource: IOResult | null;

  constructor(init: IOResultInit = {}) {
    this.stdout = toBytes(init.stdout ?? null);
    this.stderr = toBytes(init.stderr ?? null);
    this.exitCode = init.exitCode ?? 0;
    this.reads = init.reads ?? {};
    this.writes = init.writes ?? {};
    this.cache = init.cache ?? [];
    this.streamSource = null;
  }
}

function toBytes(v: ByteSource | string | null): Uint8Array | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Uint8Array) return v;
  if (typeof v === "string") return new TextEncoder().encode(v);
  // AsyncIterable<Uint8Array> — we don't drain here; mirage would consume it
  // via materializeStdout(). For CLI use we never produce streams.
  return null;
}
