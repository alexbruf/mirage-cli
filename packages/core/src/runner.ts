/**
 * Run a Commander.js program in-process. Bytestream in (stdin), bytestream
 * out (stdout/stderr). Designed to drop into a mirage command registration.
 *
 *   const { stdout, stderr, done } = streamCommander(program, argv, { stdin });
 *   return new Response(stdout);           // start sending bytes immediately
 *   const { exitCode } = await done;
 *
 * `runCommander` is the buffered convenience: drains both streams and gives
 * you `{ stdout, stderr, exitCode }` as Uint8Arrays.
 *
 * `toMirageCommandFn(program)` returns a function with mirage's CommandFn
 * signature (`(accessor, paths, texts, opts) => [ByteSource, IOResult]`) so
 * you can register a whole commander CLI as one mirage command.
 *
 * Concurrency model: globals (`process.{stdin,stdout,stderr,exit}`, `console.*`)
 * are patched ONCE on the first call and never restored. Each call enters its
 * own AsyncLocalStorage context; the patches read the active context out of
 * ALS to route writes/exits to the right call's streams. Outside any wrapped
 * call the patches fall through to the originals, so importing this module is
 * non-invasive for code that never calls `streamCommander`.
 *
 * As long as wrapped actions await their own async work (required for streaming
 * anyway), two simultaneous `streamCommander` calls won't interleave output or
 * cross exit codes.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Structural minimum a wrapped CLI program must satisfy. Real Commander
 * `Command` instances satisfy this trivially. Typing it structurally instead
 * of importing `Command` from `commander` directly means consumers using
 * different commander major versions (12, 13, 14, …) can hand us their
 * `Command` without a type-only version mismatch.
 */
export interface CommanderProgram {
  parseAsync(argv: readonly string[], parseOptions?: { from?: "node" | "electron" | "user" }): Promise<unknown>;
  exitOverride(callback?: (err: { exitCode?: number; code?: string; message?: string }) => never | void): unknown;
}

/** Back-compat alias. Prefer `CommanderProgram`. */
export type Command = CommanderProgram;

/**
 * Matches @struktoai/mirage-core io/types.ts. A ReadableStream<Uint8Array> is
 * AsyncIterable at runtime on workerd, Node 20+, and Bun — we widen the type
 * to make TS aware of that even when the underlying lib defs miss it.
 */
export type ByteSource =
  | Uint8Array
  | AsyncIterable<Uint8Array>
  | ReadableStream<Uint8Array>;

export interface StreamResult {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  done: Promise<{ exitCode: number; error: unknown }>;
}

export interface RunResult {
  stdout: Uint8Array;
  stderr: Uint8Array;
  exitCode: number;
  error: unknown;
}

export interface StreamOptions {
  /** Bytes (or async iterable) fed to the wrapped program as stdin. */
  stdin?: ByteSource | null;
}

const ENC = new TextEncoder();

class ExitSignal extends Error {
  readonly code: number;
  constructor(code: number) { super(`__mirage_exit__:${code}`); this.code = code; }
}

function toBytes(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk;
  if (typeof chunk === "string") return ENC.encode(chunk);
  if (chunk == null) return new Uint8Array();
  return ENC.encode(String(chunk));
}

function formatConsoleArgs(args: readonly unknown[]): string {
  return args.map((a) => {
    if (typeof a === "string") return a;
    if (a instanceof Error) return a.stack ?? a.message;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(" ") + "\n";
}

function isCommanderError(e: unknown): e is { exitCode?: number; code?: string } {
  return !!e && typeof e === "object" && "code" in (e as object) &&
    typeof (e as { code?: unknown }).code === "string" &&
    (e as { code: string }).code.startsWith("commander.");
}

/**
 * Build a duck-typed Node `Readable`-ish over a ByteSource so commander actions
 * that read from `process.stdin` see the bytes the caller provided.
 *
 * Supports: `on('data')`, `on('end')`, `[Symbol.asyncIterator]`, `setEncoding()`,
 * `resume()`, `pause()`, `pipe(dest)`. Enough for typical CLI patterns; doesn't
 * try to be a full Readable.
 */
function makeStdin(source: ByteSource | null | undefined): unknown {
  if (source == null) return null;
  const handlers: Record<string, Set<Function>> = {
    data: new Set(), end: new Set(), error: new Set(), close: new Set(), readable: new Set(),
  };
  let consumed = false;
  let encoding: string | null = null;

  async function* iter(): AsyncIterable<Uint8Array> {
    if (source == null) return;
    if (source instanceof Uint8Array) {
      if (source.length > 0) yield source;
      return;
    }
    // ReadableStream is AsyncIterable in workerd/Node 20+/Bun, but TS doesn't
    // see that on its lib defs; if Symbol.asyncIterator isn't there, fall back
    // to manual reader.read() draining.
    const anyish = source as unknown as { [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array>; getReader?: () => ReadableStreamDefaultReader<Uint8Array> };
    if (typeof anyish[Symbol.asyncIterator] === "function") {
      for await (const chunk of source as AsyncIterable<Uint8Array>) {
        yield chunk instanceof Uint8Array ? chunk : toBytes(chunk);
      }
      return;
    }
    if (typeof anyish.getReader === "function") {
      const reader = anyish.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) yield value;
      }
    }
  }

  function emit(name: string, ...args: unknown[]): void {
    const set = handlers[name];
    if (!set) return;
    for (const fn of set) {
      try { (fn as (...a: unknown[]) => void)(...args); } catch { /* swallow */ }
    }
  }

  function startEmitting(): void {
    if (consumed) return;
    consumed = true;
    void (async () => {
      try {
        for await (const chunk of iter()) {
          const out = encoding ? new TextDecoder(encoding).decode(chunk) : chunk;
          emit("data", out);
        }
        emit("end");
        emit("close");
      } catch (err) {
        emit("error", err);
      }
    })();
  }

  const stub = {
    readable: true,
    isTTY: false,
    on(event: string, fn: (...a: unknown[]) => void) {
      (handlers[event] ?? (handlers[event] = new Set())).add(fn);
      if (event === "data" || event === "readable") startEmitting();
      return stub;
    },
    once(event: string, fn: (...a: unknown[]) => void) {
      const wrapped = (...args: unknown[]) => { stub.off(event, wrapped); fn(...args); };
      return stub.on(event, wrapped);
    },
    off(event: string, fn: (...a: unknown[]) => void) {
      handlers[event]?.delete(fn);
      return stub;
    },
    removeListener(event: string, fn: (...a: unknown[]) => void) { return stub.off(event, fn); },
    setEncoding(enc: string) { encoding = enc; return stub; },
    resume() { startEmitting(); return stub; },
    pause() { return stub; },
    pipe(dest: { write?: Function; end?: Function }) {
      void (async () => {
        for await (const chunk of iter()) dest.write?.(chunk);
        dest.end?.();
      })();
      return dest;
    },
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      return iter()[Symbol.asyncIterator]();
    },
  };
  return stub;
}

/* ---------------------------------------------------------------------------
 * Patch installation. Globals (process.{stdout,stderr,stdin,exit} and console.*)
 * are patched ONCE on first call, never restored. Each patch reads the active
 * call's context out of AsyncLocalStorage. When no context is active, calls
 * fall through to the originals — so importing this module is non-invasive.
 * ------------------------------------------------------------------------- */

interface RunCtx {
  outWriter: WritableStreamDefaultWriter<Uint8Array>;
  errWriter: WritableStreamDefaultWriter<Uint8Array>;
  stdin: unknown;
}

const als = new AsyncLocalStorage<RunCtx>();
let patched = false;

function ensurePatched(): void {
  if (patched) return;
  patched = true;

  // console.* is always present; patch it regardless of `process`.
  const origConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };
  const toOut = (orig: (...a: unknown[]) => void) =>
    (...a: unknown[]) => {
      const ctx = als.getStore();
      if (ctx) {
        void ctx.outWriter.write(ENC.encode(formatConsoleArgs(a))).catch(() => {});
        return;
      }
      orig(...a);
    };
  const toErr = (orig: (...a: unknown[]) => void) =>
    (...a: unknown[]) => {
      const ctx = als.getStore();
      if (ctx) {
        void ctx.errWriter.write(ENC.encode(formatConsoleArgs(a))).catch(() => {});
        return;
      }
      orig(...a);
    };
  console.log = toOut(origConsole.log);
  console.info = toOut(origConsole.info);
  console.debug = toOut(origConsole.debug);
  console.warn = toErr(origConsole.warn);
  console.error = toErr(origConsole.error);

  const proc = (globalThis as any).process as
    | {
        stdin?: unknown;
        stdout?: { write?: Function };
        stderr?: { write?: Function };
        exit?: Function;
      }
    | undefined;
  if (!proc) return;

  const stdout = proc.stdout;
  const stderr = proc.stderr;
  const origStdoutWrite = stdout?.write?.bind(stdout);
  const origStderrWrite = stderr?.write?.bind(stderr);
  const origExit = proc.exit?.bind(proc);
  const origStdin = proc.stdin;

  if (stdout) {
    (stdout as any).write = (chunk: unknown, enc?: unknown, cb?: unknown): boolean => {
      const ctx = als.getStore();
      if (ctx) {
        void ctx.outWriter.write(toBytes(chunk)).catch(() => {});
        if (typeof cb === "function") (cb as () => void)();
        return true;
      }
      return origStdoutWrite ? origStdoutWrite(chunk, enc, cb) : false;
    };
  }
  if (stderr) {
    (stderr as any).write = (chunk: unknown, enc?: unknown, cb?: unknown): boolean => {
      const ctx = als.getStore();
      if (ctx) {
        void ctx.errWriter.write(toBytes(chunk)).catch(() => {});
        if (typeof cb === "function") (cb as () => void)();
        return true;
      }
      return origStderrWrite ? origStderrWrite(chunk, enc, cb) : false;
    };
  }

  (proc as any).exit = (code: number = 0) => {
    const ctx = als.getStore();
    if (ctx) throw new ExitSignal(code);
    if (origExit) return origExit(code);
  };

  // process.stdin: install a getter so each in-flight call sees its own stub.
  try {
    Object.defineProperty(proc, "stdin", {
      configurable: true,
      get() {
        const ctx = als.getStore();
        return ctx && ctx.stdin != null ? ctx.stdin : origStdin;
      },
    });
  } catch {
    // Host disallows redefinition (unusual). Leave proc.stdin as-is; actions
    // that read stdin from this isolate won't get per-call isolation, but
    // everything else still works.
  }
}

/**
 * Walk a commander program tree and call `exitOverride()` on every command
 * (root + every subcommand recursively). Commander v14's `Command.prototype._exit`
 * has no parent-chain walk — a leaf without its own `_exitCallback` falls
 * through to `process.exit()`, which we can't always patch in workerd. By
 * setting `exitOverride()` on every node, commander throws `CommanderError`
 * consistently on --help/--version/error paths regardless of where in the
 * tree the path was triggered.
 */
function applyExitOverrideRecursively(program: CommanderProgram): void {
  const seen = new WeakSet<object>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const n = node as { exitOverride?: () => unknown; commands?: unknown[] };
    if (typeof n.exitOverride === "function") n.exitOverride();
    if (Array.isArray(n.commands)) {
      for (const sub of n.commands) visit(sub);
    }
  };
  visit(program);
}

export function streamCommander(
  program: CommanderProgram,
  argv: readonly string[],
  opts: StreamOptions = {},
): StreamResult {
  ensurePatched();

  const outStream = new TransformStream<Uint8Array, Uint8Array>();
  const errStream = new TransformStream<Uint8Array, Uint8Array>();
  const outWriter = outStream.writable.getWriter();
  const errWriter = errStream.writable.getWriter();

  const ctx: RunCtx = {
    outWriter,
    errWriter,
    stdin: opts.stdin != null ? makeStdin(opts.stdin) : null,
  };

  // Apply exitOverride() to the entire command tree, not just the root.
  // Commander's `_exit()` does NOT walk up the parent chain to find an
  // inherited `_exitCallback` — so a leaf subcommand without its own override
  // falls through to `process.exit()` on --help/--version/error paths. We
  // patch `process.exit` too (see `ensurePatched`), but in workerd that
  // patch is silently rejected (process.exit is non-writable). That combo
  // leads to leaf `--help` invocations hanging: commander returns from the
  // help-printing path back into `_parseCommand`, which then runs the
  // action handler with empty args, firing a no-param API call that
  // never completes. Setting exitOverride on every node makes commander
  // throw a CommanderError consistently, which the catch below converts
  // to an exitCode.
  applyExitOverrideRecursively(program);

  const done = als.run(ctx, async (): Promise<{ exitCode: number; error: unknown }> => {
    let exitCode = 0;
    let error: unknown = null;
    try {
      await program.parseAsync(argv as string[], { from: "user" });
    } catch (e) {
      if (e instanceof ExitSignal) {
        exitCode = e.code;
      } else if (isCommanderError(e)) {
        exitCode = e.exitCode ?? 1;
      } else {
        error = e;
      }
    } finally {
      await outWriter.close().catch(() => {});
      await errWriter.close().catch(() => {});
    }
    return { exitCode, error };
  });

  return { stdout: outStream.readable, stderr: errStream.readable, done };
}

export async function runCommander(
  program: CommanderProgram,
  argv: readonly string[],
  opts: StreamOptions = {},
): Promise<RunResult> {
  const s = streamCommander(program, argv, opts);
  const [stdout, stderr, final] = await Promise.all([
    drain(s.stdout),
    drain(s.stderr),
    s.done,
  ]);
  return { stdout, stderr, exitCode: final.exitCode, error: final.error };
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.length) chunks.push(value);
  }
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/* ---------------------------------------------------------------------------
 * Mirage adapter.
 *
 * Mirage's CommandFn signature (from @struktoai/mirage-core):
 *   (accessor, paths, texts, opts) => Promise<[ByteSource | null, IOResult]>
 *
 * - `texts` carries the argv (TEXT-kind operands).
 * - `opts.stdin` is the bytestream input (`ByteSource | null`).
 * - The returned IOResult carries `stderr: ByteSource`, `exitCode: number`,
 *   plus the empty `reads/writes/cache` mirage expects.
 *
 * Mirage's runtime hands us stdin and walks away — it doesn't drain or cancel
 * the source after the CommandFn returns. So our lazy `makeStdin` shim
 * (doesn't touch the source until the action attaches a listener or iterates)
 * is safe: unread bytes stay unread, no leak, no upstream backpressure deadlock.
 * For pipeline intermediates mirage itself runs `closeQuietly` on the source.
 *
 * We don't import @struktoai/mirage-core (no peer dep). The returned object
 * is shape-compatible — mirage runtimes duck-type it. If your mirage version
 * exposes its own `IOResult` class, wrap the return value through
 * `new IOResult({ stderr, exitCode })`.
 * ------------------------------------------------------------------------- */

export interface MirageIOResult {
  stdout: ByteSource | null;
  stderr: ByteSource | null;
  exitCode: number;
  reads: Record<string, ByteSource>;
  writes: Record<string, ByteSource>;
  cache: string[];
}

export type MirageCommandFn = (
  accessor: unknown,
  paths: readonly string[] | readonly unknown[],
  texts: readonly string[],
  opts: { stdin?: ByteSource | null; flags?: Record<string, string | boolean> },
) => Promise<[ByteSource | null, MirageIOResult]>;

/**
 * Build a mirage-compatible CommandFn from a Commander program. Argv comes
 * in via `texts`; stdin via `opts.stdin`.
 *
 *   import { command } from "@struktoai/mirage-core"
 *   import { toMirageCommandFn } from "@mirage-cli/core"
 *
 *   const dfs = command({
 *     name: "dfs",
 *     resource: null,
 *     spec: new CommandSpec({ rest: new Operand({ kind: OperandKind.TEXT }) }),
 *     fn: toMirageCommandFn(buildDfsProgram()),
 *   })
 */
/**
 * Optional shape of mirage-core's `IOResult` class. Pass this constructor to
 * `toMirageCommandFn` and the returned tuple's second slot will be a real
 * `IOResult` instance — required when mirage's executor calls `.syncExitCode()`
 * on it (as it does inside `executeProgram` for pipeline composition).
 */
export type IOResultCtor = new (init: {
  stderr?: ByteSource | null;
  exitCode?: number;
  reads?: Record<string, ByteSource>;
  writes?: Record<string, ByteSource>;
  cache?: string[];
}) => MirageIOResult;

export interface ToMirageOptions {
  /**
   * Pass `mirageCore.IOResult` here when you're plugging the resulting
   * CommandFn into a real mirage `Workspace`. Without it, the returned
   * tuple's second slot is a plain object that satisfies the structural
   * `MirageIOResult` shape but lacks `.syncExitCode()` / `.materializeStdout()`
   * etc. that mirage's executor expects on real IOResult instances.
   */
  IOResult?: IOResultCtor;
}

export function toMirageCommandFn(
  program: CommanderProgram,
  options: ToMirageOptions = {},
): MirageCommandFn {
  return async (_accessor, _paths, texts, opts) => {
    const stream = streamCommander(program, texts, { stdin: opts.stdin ?? null });
    // We hand mirage the stdout stream directly. The exitCode is filled in
    // Pipe BOTH stdout and stderr through outer TransformStreams. Reasons:
    //
    //   1. stderr needs to drain even if the consumer never reads it — Bun's
    //      `TransformStream.writable.close()` blocks while the readable side
    //      has unread bytes, which would deadlock `streamCommander`'s finally
    //      (it awaits `errWriter.close()`) and hang `stream.done`.
    //
    //   2. We hold the outer stdout's `close` signal until `stream.done` has
    //      resolved and ioresult.exitCode has been written. Consumers who
    //      drain stdout and then read ioresult.exitCode never see a stale 0.
    const outStdout = new TransformStream<Uint8Array, Uint8Array>();
    const outStderr = new TransformStream<Uint8Array, Uint8Array>();

    // Use mirage-core's real IOResult class if the caller supplied it
    // (required when handing off to mirage's executor — it calls methods on
    // the IOResult instance). Otherwise return a plain object that satisfies
    // the structural MirageIOResult shape.
    const ioresult: MirageIOResult = options.IOResult
      ? new options.IOResult({
          stderr: outStderr.readable,
          exitCode: 0,
          reads: {},
          writes: {},
          cache: [],
        })
      : {
          stdout: null,
          stderr: outStderr.readable,
          exitCode: 0,
          reads: {},
          writes: {},
          cache: [],
        };

    // Stderr pump — purely a drain bridge.
    void pipe(stream.stderr, outStderr.writable);

    // Stdout pump — additionally awaits `done` before closing.
    void (async () => {
      const reader = stream.stdout.getReader();
      const writer = outStdout.writable.getWriter();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) await writer.write(value);
        }
      } finally {
        const final = await stream.done.catch(() => ({ exitCode: 1, error: null }));
        ioresult.exitCode = final.exitCode;
        await writer.close().catch(() => {});
      }
    })();

    return [outStdout.readable, ioresult];
  };
}

async function pipe(
  src: ReadableStream<Uint8Array>,
  dst: WritableStream<Uint8Array>,
): Promise<void> {
  const reader = src.getReader();
  const writer = dst.getWriter();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) await writer.write(value);
    }
  } finally {
    await writer.close().catch(() => {});
  }
}
