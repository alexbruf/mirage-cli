/**
 * File IO that works both on a real filesystem and inside a Mirage workspace.
 *
 * Mirage hosts (ve-brain) install `globalThis.__MIRAGE_CLI_FILE_IO__` before
 * invoking a command and flush its writes back to the VFS afterwards, so a path
 * like `/data/hero.png` resolves even though workerd has no filesystem. The
 * bridge only claims paths under the workspace's own roots, hence `canHandle`;
 * everything else falls through to `node:fs`, which is imported dynamically so
 * a workerd bundle never needs it at load time.
 *
 * Same shape as `@mirage-cli/openrouter-cli` and `@mirage-cli/rapidurlindexer-cli`.
 */

interface MirageCliFileIoBridge {
  canHandle?(path: unknown): boolean;
  readFileSync?(path: unknown, options?: unknown): Uint8Array | string | null;
  writeFileSync?(path: unknown, data: unknown, options?: unknown): boolean;
}

function bridge(): MirageCliFileIoBridge | undefined {
  return (
    globalThis as typeof globalThis & { __MIRAGE_CLI_FILE_IO__?: MirageCliFileIoBridge }
  ).__MIRAGE_CLI_FILE_IO__;
}

/** Read a UTF-8 text file, or stdin when `path` is "-". */
export async function readTextFile(path: string): Promise<string> {
  if (path === "-") return readStdin();
  const io = bridge();
  if (io?.canHandle?.(path)) {
    const value = io.readFileSync?.(path, "utf8");
    if (value === null || value === undefined) {
      throw new Error(`Mirage VFS could not read: ${path}`);
    }
    return typeof value === "string" ? value : new TextDecoder().decode(value);
  }
  const { readFileSync } = await import("node:fs");
  return readFileSync(path, "utf8");
}

/** Read and parse a JSON request body from a file or stdin. */
export async function readJsonFile<T = unknown>(path: string): Promise<T> {
  const raw = await readTextFile(path);
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${path} is not valid JSON: ${message}`);
  }
}

/** Write bytes, creating parent directories on a real filesystem. */
export async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  const io = bridge();
  if (io?.canHandle?.(path)) {
    if (io.writeFileSync?.(path, bytes)) return;
    throw new Error(`Mirage VFS refused to write: ${path}`);
  }
  const [{ dirname }, { mkdirSync, writeFileSync }] = await Promise.all([
    import("node:path"),
    import("node:fs"),
  ]);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}
