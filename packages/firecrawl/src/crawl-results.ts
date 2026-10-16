/**
 * `firecrawl crawl-results <job-id>` — fetch the pages of a crawl job.
 *
 * Upstream `firecrawl crawl <job-id>` reports only the job's status and drops
 * the page data, and its multi-page commands save into a local `.firecrawl/`
 * folder that a Worker cannot write. This command reads `GET /v2/crawl/{id}`,
 * follows `next` until every page is collected, then either prints the pages
 * as JSON or writes one markdown file per page under `--dir`, in folders that
 * mirror each page's host and URL path, plus an `_index.json` manifest.
 *
 * Writes go through `globalThis.__MIRAGE_CLI_FILE_IO__` when the host installs
 * it (ve-brain does, for paths under its mounts) and fall back to `node:fs`.
 */

import type { Command } from "commander";

const DEFAULT_API_URL = "https://api.firecrawl.dev";

interface MirageCliFileIoBridge {
  canHandle?(path: unknown): boolean;
  readFileSync?(path: unknown, options?: unknown): Uint8Array | string | null;
  writeFileSync?(path: unknown, data: unknown, options?: unknown): boolean;
}

function bridge(): MirageCliFileIoBridge | undefined {
  return (globalThis as typeof globalThis & { __MIRAGE_CLI_FILE_IO__?: MirageCliFileIoBridge })
    .__MIRAGE_CLI_FILE_IO__;
}

export interface CrawlDocument {
  markdown?: string;
  html?: string;
  rawHtml?: string;
  metadata?: {
    sourceURL?: string;
    url?: string;
    title?: string;
    statusCode?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface CrawlPage {
  id: string;
  status: string;
  total: number;
  completed: number;
  creditsUsed?: number;
  expiresAt?: string;
  next?: string | null;
  data?: CrawlDocument[];
}

export interface CrawlResults {
  id: string;
  status: string;
  total: number;
  completed: number;
  creditsUsed?: number;
  expiresAt?: string;
  pages: CrawlDocument[];
}

export interface CrawlResultsOptions {
  apiKey: string;
  apiUrl?: string;
  maxPages?: number;
  fetchImpl?: typeof fetch;
}

/** Fetch a crawl job and every page of its results, following `next`. */
export async function fetchCrawlResults(
  jobId: string,
  options: CrawlResultsOptions,
): Promise<CrawlResults> {
  const doFetch = options.fetchImpl ?? fetch;
  const base = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
  let url: string | null = `${base}/v2/crawl/${encodeURIComponent(jobId)}`;
  let first: CrawlPage | null = null;
  const pages: CrawlDocument[] = [];

  while (url) {
    const res = await doFetch(url, {
      headers: { Authorization: `Bearer ${options.apiKey}` },
    });
    const text = await res.text();
    let body: (CrawlPage & { error?: string; success?: boolean }) | null = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* reported below */
    }
    if (!res.ok || !body) {
      const detail = body?.error ?? text.slice(0, 300);
      throw new Error(`crawl-results: HTTP ${res.status} for job ${jobId}: ${detail}`);
    }
    first ??= body;
    for (const doc of body.data ?? []) {
      pages.push(doc);
      if (options.maxPages !== undefined && pages.length >= options.maxPages) break;
    }
    if (options.maxPages !== undefined && pages.length >= options.maxPages) break;
    url = body.next ? absoluteNext(body.next, base) : null;
  }

  const head = first as CrawlPage;
  return {
    id: head.id ?? jobId,
    status: head.status,
    total: head.total,
    completed: head.completed,
    creditsUsed: head.creditsUsed,
    expiresAt: head.expiresAt,
    pages,
  };
}

function absoluteNext(next: string, base: string): string {
  // The API returns an absolute URL; keep relative ones working too, and keep
  // a custom --api-url (self-hosted) from being swapped for the public host.
  if (/^https?:\/\//i.test(next)) return next;
  return `${base}${next.startsWith("/") ? "" : "/"}${next}`;
}

function pageUrl(doc: CrawlDocument): string | undefined {
  const meta = doc.metadata ?? {};
  return (meta.sourceURL as string | undefined) ?? (meta.url as string | undefined);
}

function safeSegment(segment: string): string {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    /* keep the raw segment */
  }
  const cleaned = decoded.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (cleaned === "" || cleaned === "." || cleaned === "..") return "_";
  return cleaned.slice(0, 120);
}

function shortHash(value: string): string {
  // FNV-1a, enough to keep two query-string variants of one path apart.
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Relative file path for a page: `<host>/<path>.md`. A path ending in `/`
 * (or the site root) becomes `<path>/index.md`; a query string adds a short
 * hash so `?page=2` does not overwrite the plain page.
 */
export function relativePagePath(url: string | undefined, fallbackIndex: number): string {
  if (!url) return `_unknown/page-${fallbackIndex + 1}.md`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `_unknown/page-${fallbackIndex + 1}.md`;
  }
  const host = safeSegment(parsed.host);
  const rawSegments = parsed.pathname.split("/").filter((s) => s !== "");
  const segments = rawSegments.map(safeSegment);
  if (segments.length === 0 || parsed.pathname.endsWith("/")) segments.push("index");
  let last = segments.pop() as string;
  if (parsed.search) last = `${last}__${shortHash(parsed.search)}`;
  return [host, ...segments, `${last}.md`].join("/");
}

function pageBody(doc: CrawlDocument): string {
  if (typeof doc.markdown === "string") return doc.markdown;
  if (typeof doc.html === "string") return doc.html;
  if (typeof doc.rawHtml === "string") return doc.rawHtml;
  return "";
}

export interface WrittenPage {
  url?: string;
  file: string;
  title?: string;
  statusCode?: number;
  bytes: number;
}

/** Plan the files for a crawl: unique paths, bodies and a manifest. */
export function planCrawlFiles(results: CrawlResults): {
  files: { path: string; body: string }[];
  manifest: WrittenPage[];
} {
  const used = new Set<string>();
  const files: { path: string; body: string }[] = [];
  const manifest: WrittenPage[] = [];
  const enc = new TextEncoder();
  results.pages.forEach((doc, i) => {
    const url = pageUrl(doc);
    let path = relativePagePath(url, i);
    if (used.has(path)) {
      const stem = path.slice(0, -3);
      let n = 2;
      while (used.has(`${stem}-${n}.md`)) n++;
      path = `${stem}-${n}.md`;
    }
    used.add(path);
    const body = pageBody(doc);
    files.push({ path, body });
    manifest.push({
      url,
      file: path,
      title: doc.metadata?.title as string | undefined,
      statusCode: doc.metadata?.statusCode as number | undefined,
      bytes: enc.encode(body).byteLength,
    });
  });
  return { files, manifest };
}

export async function writeText(path: string, text: string): Promise<void> {
  const bytes = new TextEncoder().encode(text);
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

/** Read a UTF-8 text file through the Mirage bridge, else `node:fs`. */
export async function readText(path: string): Promise<string> {
  const io = bridge();
  if (io?.canHandle?.(path)) {
    const value = io.readFileSync?.(path, "utf8");
    if (value === null || value === undefined) throw new Error(`cannot read ${path}`);
    return typeof value === "string" ? value : new TextDecoder().decode(value);
  }
  const { readFileSync } = await import("node:fs");
  return readFileSync(path, "utf8");
}

/** Write a crawl's pages under `dir`. Returns the manifest that was written. */
export async function writeCrawlResults(
  results: CrawlResults,
  dir: string,
): Promise<WrittenPage[]> {
  const root = dir.replace(/\/+$/, "") || "/";
  const join = (rel: string) => (root === "/" ? `/${rel}` : `${root}/${rel}`);
  const { files, manifest } = planCrawlFiles(results);
  for (const file of files) await writeText(join(file.path), file.body);
  const index = {
    id: results.id,
    status: results.status,
    total: results.total,
    completed: results.completed,
    creditsUsed: results.creditsUsed,
    expiresAt: results.expiresAt,
    pages: manifest,
  };
  await writeText(join("_index.json"), `${JSON.stringify(index, null, 2)}\n`);
  return manifest;
}

export function resolveApiKey(cmd: Command, local?: string): string | undefined {
  if (local) return local;
  let cur: Command | null = cmd.parent;
  while (cur) {
    const key = (cur.opts() as { apiKey?: string }).apiKey;
    if (key) return key;
    cur = cur.parent;
  }
  const env = process.env.FIRECRAWL_API_KEY;
  return env && env !== "noop" ? env : undefined;
}

/** Register `crawl-results` on the captured firecrawl program (idempotent). */
export function addCrawlResultsCommand(program: Command): void {
  if (program.commands.some((c) => c.name() === "crawl-results")) return;
  program
    .command("crawl-results")
    .description(
      "Fetch the pages of a crawl job (from `firecrawl crawl <url>`). Prints JSON, or with --dir writes one markdown file per page in folders that mirror the site, plus _index.json. Free: reading results does not use credits.",
    )
    .argument("<job-id>", "Crawl job ID")
    .option("--dir <path>", "Write pages as files under this folder instead of printing JSON")
    .option("--max-pages <number>", "Stop after this many pages", (v) => Number.parseInt(v, 10))
    .option("--pretty", "Pretty-print JSON output", false)
    .option("-k, --api-key <key>", "Firecrawl API key (overrides global --api-key)")
    .option("--api-url <url>", "API URL (default https://api.firecrawl.dev)")
    .addHelpText(
      "after",
      `
Examples:
  $ firecrawl crawl https://example.com --limit 50     # start; prints a job ID
  $ firecrawl crawl <job-id>                           # check progress
  $ firecrawl crawl-results <job-id> --dir /data/crawls/example
  $ firecrawl crawl-results <job-id> --max-pages 5 --pretty
`,
    )
    .action(async (jobId: string, opts: Record<string, unknown>, cmd: Command) => {
      const apiKey = resolveApiKey(cmd, opts.apiKey as string | undefined);
      if (!apiKey) {
        cmd.error("Error: no Firecrawl API key. Pass --api-key or set FIRECRAWL_API_KEY.");
      }
      try {
        const results = await fetchCrawlResults(jobId, {
          apiKey,
          apiUrl: opts.apiUrl as string | undefined,
          maxPages: opts.maxPages as number | undefined,
        });
        if (results.status !== "completed") {
          console.error(
            `Warning: crawl ${results.id} is ${results.status} (${results.completed}/${results.total} pages); showing the pages finished so far.`,
          );
        }
        const dir = opts.dir as string | undefined;
        if (dir) {
          const manifest = await writeCrawlResults(results, dir);
          const root = dir.replace(/\/+$/, "");
          const lines = [
            `Wrote ${manifest.length} page${manifest.length === 1 ? "" : "s"} to ${root}/ (status ${results.status}, ${results.completed}/${results.total}).`,
            `Index: ${root}/_index.json`,
            ...manifest.slice(0, 20).map((p) => `  ${p.file}  ${p.url ?? ""}`),
          ];
          if (manifest.length > 20) lines.push(`  … ${manifest.length - 20} more in _index.json`);
          process.stdout.write(`${lines.join("\n")}\n`);
          return;
        }
        const out = opts.pretty ? JSON.stringify(results, null, 2) : JSON.stringify(results);
        process.stdout.write(`${out}\n`);
      } catch (err) {
        cmd.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
}
