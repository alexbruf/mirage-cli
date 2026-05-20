/**
 * Mirage-compatible primitives. The runtime classes implement
 * `@struktoai/mirage-core`'s interfaces — imported as `import type`, so the
 * mirage package contributes zero bundle bytes but tsc still enforces shape
 * parity (if mirage adds a field, the build breaks).
 */
import type {
  Option as MOption,
  Operand as MOperand,
  CommandSpec as MCommandSpec,
  OptionInit as MOptionInit,
  OperandInit as MOperandInit,
  CommandSpecInit as MCommandSpecInit,
  IOResultInit as MIOResultInit,
  OperandKind as MOperandKind,
  ByteSource,
} from "@struktoai/mirage-core";

export type { ByteSource };

export type OperandKind = MOperandKind;
export const OperandKind = Object.freeze({
  NONE: "none",
  PATH: "path",
  TEXT: "text",
} as const);

// CLI extras (defaultValue, required) on top of mirage's shape.
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

  get name(): string {
    return this.long ?? this.short ?? "";
  }
}

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
    this.rest = (init.rest as Operand | null) ?? null;
    this.ignoreTokens = new Set(init.ignoreTokens ?? []);
    this.description = init.description ?? null;
    Object.freeze(this);
  }
}

export interface IOResultInit extends Omit<MIOResultInit, "stdout" | "stderr"> {
  stdout?: ByteSource | string | null;
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
  if (v === null) return null;
  if (v instanceof Uint8Array) return v;
  if (typeof v === "string") return new TextEncoder().encode(v);
  return null;
}
