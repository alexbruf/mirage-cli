import { MAX_PROJECT_URLS, validatePublicHttpUrl } from "./client.ts";

export const DEFAULT_MAX_URL_FILE_BYTES = 16 * 1024 * 1024;

export interface ReadUrlsFileOptions {
  maxBytes?: number;
}

interface MirageCliFileIoBridge {
  canHandle?(path: unknown): boolean;
  readFileSync?(path: unknown, options?: unknown): Uint8Array | string | null;
}

/**
 * Parse a newline-delimited URL file. Blank lines and whole-line comments are
 * ignored, duplicates are removed in first-seen order, and every remaining
 * entry must be an absolute public HTTP(S) URL without embedded credentials.
 */
export function parseUrlText(text: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const value = rawLine.trim();
    if (!value || value.startsWith("#")) continue;
    validatePublicHttpUrl(value);
    if (!seen.has(value)) {
      seen.add(value);
      urls.push(value);
    }
  }
  if (urls.length === 0) throw new Error("URL input contains no URLs");
  if (urls.length > MAX_PROJECT_URLS) {
    throw new Error(`URL input contains ${urls.length} URLs; maximum is ${MAX_PROJECT_URLS}`);
  }
  return urls;
}

export function mergeUrls(...groups: readonly string[][]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const raw of group) {
      const value = raw.trim();
      validatePublicHttpUrl(value);
      if (!seen.has(value)) {
        seen.add(value);
        merged.push(value);
      }
    }
  }
  if (merged.length === 0) {
    throw new Error("provide at least one --url or --urls-file");
  }
  if (merged.length > MAX_PROJECT_URLS) {
    throw new Error(`project contains ${merged.length} URLs; maximum is ${MAX_PROJECT_URLS}`);
  }
  return merged;
}

/**
 * Read through Mirage's VFS bridge when present, then fall back to local
 * node:fs. The fallback is dynamically imported so mounted workerd calls for
 * /sessions and /data never need a Node filesystem implementation.
 */
export async function readUrlsFile(
  path: string,
  options: ReadUrlsFileOptions = {},
): Promise<string[]> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_URL_FILE_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("maxBytes must be a positive integer");
  }

  const bridge = (
    globalThis as typeof globalThis & {
      __MIRAGE_CLI_FILE_IO__?: MirageCliFileIoBridge;
    }
  ).__MIRAGE_CLI_FILE_IO__;
  if (bridge?.canHandle?.(path)) {
    const value = bridge.readFileSync?.(path, "utf8");
    if (value === null || value === undefined) {
      throw new Error(`Mirage VFS could not read URL input: ${path}`);
    }
    const text = typeof value === "string" ? value : decodeBounded(value, maxBytes, path);
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error(`URL input exceeds the ${maxBytes}-byte safety limit: ${path}`);
    }
    return parseUrlText(text);
  }

  const fs = await import("node:fs");
  const stat = fs.statSync(path);
  if (!stat.isFile()) throw new Error(`URL input is not a regular file: ${path}`);
  if (stat.size > maxBytes) {
    throw new Error(`URL input exceeds the ${maxBytes}-byte safety limit: ${path}`);
  }
  const bytes = fs.readFileSync(path);
  if (bytes.byteLength > maxBytes) {
    throw new Error(`URL input exceeds the ${maxBytes}-byte safety limit: ${path}`);
  }
  return parseUrlText(decodeBounded(bytes, maxBytes, path));
}

function decodeBounded(bytes: Uint8Array, maxBytes: number, path: string): string {
  if (bytes.byteLength > maxBytes) {
    throw new Error(`URL input exceeds the ${maxBytes}-byte safety limit: ${path}`);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
