/**
 * In-process stdio capture. Patches the global write paths a Commander CLI
 * is likely to use (process.stdout/stderr, console.*) and converts
 * process.exit() into a captured exitCode rather than killing the host.
 *
 * Lower-level than `streamCommander` / `runCommander` — accepts any async
 * function, not just a commander program. Use this when the thing you want
 * to capture isn't a `Command`.
 *
 * NOT concurrency-safe. Unlike `streamCommander`, this primitive uses
 * per-call save/restore of global write paths rather than AsyncLocalStorage.
 * Two simultaneous `captureStdio` calls in the same isolate WILL interleave
 * output and corrupt the saved originals. Only one may be in flight at a
 * time per isolate. If you need concurrent captures of commander programs,
 * use `streamCommander`. If you need them for arbitrary async functions,
 * file an issue — converging this onto the ALS machinery is straightforward
 * but currently out of scope.
 */

export interface CaptureResult {
  stdout: Uint8Array;
  stderr: Uint8Array;
  exitCode: number;
}

const ENC = new TextEncoder();

class ExitSignal extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`__mirage_exit__:${code}`);
    this.code = code;
  }
}

function toBytes(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk;
  if (typeof chunk === "string") return ENC.encode(chunk);
  if (chunk == null) return new Uint8Array();
  return ENC.encode(String(chunk));
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function formatConsoleArgs(args: readonly unknown[]): string {
  return args.map((a) => {
    if (typeof a === "string") return a;
    if (a instanceof Error) return a.stack ?? a.message;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(" ") + "\n";
}

export async function captureStdio<T>(fn: () => Promise<T> | T): Promise<{
  value: T | undefined;
  capture: CaptureResult;
  error: unknown;
}> {
  const outChunks: Uint8Array[] = [];
  const errChunks: Uint8Array[] = [];
  let exitCode = 0;

  const proc = (globalThis as any).process as
    | { stdout?: { write?: Function }; stderr?: { write?: Function }; exit?: Function }
    | undefined;
  const stdout = proc?.stdout;
  const stderr = proc?.stderr;

  const origStdoutWrite = stdout?.write?.bind(stdout);
  const origStderrWrite = stderr?.write?.bind(stderr);
  const origExit = proc?.exit?.bind(proc);
  const origConsole = {
    log: console.log, info: console.info, warn: console.warn,
    error: console.error, debug: console.debug,
  };

  const writeOut = (chunk: unknown, _enc?: unknown, cb?: unknown): boolean => {
    outChunks.push(toBytes(chunk));
    if (typeof cb === "function") (cb as () => void)();
    return true;
  };
  const writeErr = (chunk: unknown, _enc?: unknown, cb?: unknown): boolean => {
    errChunks.push(toBytes(chunk));
    if (typeof cb === "function") (cb as () => void)();
    return true;
  };

  if (stdout) (stdout as any).write = writeOut;
  if (stderr) (stderr as any).write = writeErr;
  console.log = (...a: unknown[]) => { outChunks.push(ENC.encode(formatConsoleArgs(a))); };
  console.info = console.log;
  console.debug = console.log;
  console.warn = (...a: unknown[]) => { errChunks.push(ENC.encode(formatConsoleArgs(a))); };
  console.error = console.warn;
  if (proc) (proc as any).exit = (code: number = 0) => { throw new ExitSignal(code); };

  let value: T | undefined;
  let error: unknown = null;
  try {
    value = await fn();
  } catch (e) {
    if (e instanceof ExitSignal) {
      exitCode = e.code;
    } else {
      error = e;
    }
  } finally {
    if (stdout && origStdoutWrite) (stdout as any).write = origStdoutWrite;
    if (stderr && origStderrWrite) (stderr as any).write = origStderrWrite;
    console.log = origConsole.log;
    console.info = origConsole.info;
    console.warn = origConsole.warn;
    console.error = origConsole.error;
    console.debug = origConsole.debug;
    if (proc && origExit) (proc as any).exit = origExit;
  }

  return {
    value,
    capture: { stdout: concat(outChunks), stderr: concat(errChunks), exitCode },
    error,
  };
}
