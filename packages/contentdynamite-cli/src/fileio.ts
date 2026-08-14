interface MirageCliFileIoBridge {
  canHandle?(path: unknown): boolean;
  readFileSync?(path: unknown, options?: unknown): Uint8Array | string | null;
  writeFileSync?(path: unknown, data: unknown, options?: unknown): boolean;
}

function bridge(): MirageCliFileIoBridge | undefined {
  return (globalThis as typeof globalThis & { __MIRAGE_CLI_FILE_IO__?: MirageCliFileIoBridge })
    .__MIRAGE_CLI_FILE_IO__;
}

export async function readTextFile(path: string): Promise<string> {
  const io = bridge();
  if (io?.canHandle?.(path)) {
    const value = io.readFileSync?.(path, "utf8");
    if (value === null || value === undefined) {
      throw new Error(`Mirage VFS could not read file: ${path}`);
    }
    if (typeof value === "string") return value;
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  }
  const fs = await import("node:fs");
  return fs.readFileSync(path, "utf8");
}

export async function readBinaryFile(path: string): Promise<Uint8Array> {
  const io = bridge();
  if (io?.canHandle?.(path)) {
    const value = io.readFileSync?.(path);
    if (value === null || value === undefined) {
      throw new Error(`Mirage VFS could not read file: ${path}`);
    }
    if (typeof value === "string") return new TextEncoder().encode(value);
    return value;
  }
  const fs = await import("node:fs");
  return new Uint8Array(fs.readFileSync(path));
}

export async function writeTextFile(path: string, text: string): Promise<void> {
  const io = bridge();
  if (io?.canHandle?.(path)) {
    const ok = io.writeFileSync?.(path, text, "utf8");
    if (!ok) throw new Error(`Mirage VFS could not write file: ${path}`);
    return;
  }
  const fs = await import("node:fs");
  fs.writeFileSync(path, text);
}
