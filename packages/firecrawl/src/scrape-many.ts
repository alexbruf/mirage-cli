/**
 * `firecrawl scrape-many <urls...> --dir <path>` — scrape a list of URLs into
 * a folder.
 *
 * Upstream `firecrawl scrape <url> <url>…` saves into a hard-coded local
 * `.firecrawl/` folder, which a Worker cannot write. This command scrapes each
 * URL with `POST /v2/scrape` (a few at a time) and writes one markdown file
 * per page under `--dir`, laid out like `crawl-results`, plus `_index.json`.
 * URLs come from arguments and/or `--urls-file` (one per line, so the output
 * of `firecrawl map` works as-is). Each URL is a normal, billed scrape.
 */

import type { Command } from "commander";
import {
  type CrawlDocument,
  planCrawlFiles,
  readText,
  resolveApiKey,
  writeText,
} from "./crawl-results.ts";

const DEFAULT_API_URL = "https://api.firecrawl.dev";
const DEFAULT_CONCURRENCY = 5;
const MAX_URLS = 500;

export interface ScrapeManyOptions {
  apiKey: string;
  apiUrl?: string;
  concurrency?: number;
  format?: "markdown" | "html";
  onlyMainContent?: boolean;
  maxAge?: number;
  fetchImpl?: typeof fetch;
}

export interface ScrapeOutcome {
  url: string;
  doc?: CrawlDocument;
  error?: string;
}

/** Parse URLs from text: one per line, `#` comments and blanks ignored. */
export function parseUrlList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

async function scrapeOne(url: string, options: ScrapeManyOptions): Promise<ScrapeOutcome> {
  const doFetch = options.fetchImpl ?? fetch;
  const base = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
  const body: Record<string, unknown> = {
    url,
    formats: [options.format ?? "markdown"],
    integration: "cli",
  };
  if (options.onlyMainContent) body.onlyMainContent = true;
  if (options.maxAge !== undefined) body.maxAge = options.maxAge;
  try {
    const res = await doFetch(`${base}/v2/scrape`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: { success?: boolean; data?: CrawlDocument; error?: string } | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* reported below */
    }
    if (!res.ok || !parsed?.data) {
      return { url, error: `HTTP ${res.status}: ${parsed?.error ?? text.slice(0, 200)}` };
    }
    const doc = parsed.data;
    // Name the file after the URL that was asked for, so a redirect does not
    // move the page somewhere the caller will not look.
    doc.metadata = { ...(doc.metadata ?? {}), sourceURL: url };
    return { url, doc };
  } catch (err) {
    return { url, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Scrape every URL, at most `concurrency` at a time, keeping input order. */
export async function scrapeMany(
  urls: readonly string[],
  options: ScrapeManyOptions,
): Promise<ScrapeOutcome[]> {
  const results: ScrapeOutcome[] = new Array(urls.length);
  const limit = Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, 10));
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      results[i] = await scrapeOne(urls[i] as string, options);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, urls.length) }, worker));
  return results;
}

/** Write scraped pages under `dir` with an `_index.json` that also lists failures. */
export async function writeScrapeResults(
  outcomes: readonly ScrapeOutcome[],
  dir: string,
): Promise<{ written: number; failed: number }> {
  const root = dir.replace(/\/+$/, "") || "/";
  const join = (rel: string) => (root === "/" ? `/${rel}` : `${root}/${rel}`);
  const ok = outcomes.filter((o) => o.doc);
  const { files, manifest } = planCrawlFiles({
    id: "scrape-many",
    status: "completed",
    total: ok.length,
    completed: ok.length,
    pages: ok.map((o) => o.doc as CrawlDocument),
  });
  for (const file of files) await writeText(join(file.path), file.body);
  const failed = outcomes.filter((o) => o.error).map((o) => ({ url: o.url, error: o.error }));
  const index = { pages: manifest, failed };
  await writeText(join("_index.json"), `${JSON.stringify(index, null, 2)}\n`);
  return { written: files.length, failed: failed.length };
}

/** Register `scrape-many` on the captured firecrawl program (idempotent). */
export function addScrapeManyCommand(program: Command): void {
  if (program.commands.some((c) => c.name() === "scrape-many")) return;
  program
    .command("scrape-many")
    .description(
      "Scrape a list of URLs into a folder: one markdown file per page in folders that mirror each site, plus _index.json. Each URL is a billed scrape.",
    )
    .argument("[urls...]", "URLs to scrape")
    .requiredOption("--dir <path>", "Folder to write the pages into")
    .option("--urls-file <path>", "File with one URL per line (e.g. saved `firecrawl map` output)")
    .option("--format <format>", "markdown (default) or html", "markdown")
    .option("--only-main-content", "Include only main content", false)
    .option("--max-age <milliseconds>", "Accept cached content up to this age", (v) =>
      Number.parseInt(v, 10),
    )
    .option("--concurrency <number>", "Scrapes in flight at once (1-10, default 5)", (v) =>
      Number.parseInt(v, 10),
    )
    .option("-k, --api-key <key>", "Firecrawl API key (overrides global --api-key)")
    .option("--api-url <url>", "API URL (default https://api.firecrawl.dev)")
    .addHelpText(
      "after",
      `
Examples:
  $ firecrawl scrape-many https://example.com/a https://example.com/b --dir /data/pages
  $ firecrawl map https://example.com --search blog > /data/urls.txt
  $ firecrawl scrape-many --urls-file /data/urls.txt --dir /data/blog --only-main-content
`,
    )
    .action(async (positional: string[], opts: Record<string, unknown>, cmd: Command) => {
      const apiKey = resolveApiKey(cmd, opts.apiKey as string | undefined);
      if (!apiKey) cmd.error("Error: no Firecrawl API key. Pass --api-key or set FIRECRAWL_API_KEY.");
      const format = opts.format as string;
      if (format !== "markdown" && format !== "html") {
        cmd.error(`Error: --format must be markdown or html, not ${format}.`);
      }
      let urls = [...(positional ?? [])];
      if (opts.urlsFile) {
        try {
          urls.push(...parseUrlList(await readText(opts.urlsFile as string)));
        } catch (err) {
          cmd.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      urls = [...new Set(urls)];
      const bad = urls.filter((u) => !/^https?:\/\//i.test(u));
      if (bad.length > 0) cmd.error(`Error: not a URL: ${bad.slice(0, 3).join(", ")}`);
      if (urls.length === 0) cmd.error("Error: no URLs. Pass them as arguments or with --urls-file.");
      if (urls.length > MAX_URLS) {
        cmd.error(`Error: ${urls.length} URLs is over the ${MAX_URLS} limit; use crawl for a whole site.`);
      }

      const outcomes = await scrapeMany(urls, {
        apiKey: apiKey as string,
        apiUrl: opts.apiUrl as string | undefined,
        concurrency: opts.concurrency as number | undefined,
        format: format as "markdown" | "html",
        onlyMainContent: opts.onlyMainContent as boolean,
        maxAge: opts.maxAge as number | undefined,
      });
      const dir = opts.dir as string;
      const root = dir.replace(/\/+$/, "");
      const { written, failed } = await writeScrapeResults(outcomes, dir);
      const lines = [
        `Wrote ${written} of ${urls.length} page${urls.length === 1 ? "" : "s"} to ${root}/. Index: ${root}/_index.json`,
      ];
      for (const o of outcomes.filter((x) => x.error).slice(0, 10)) {
        lines.push(`  failed: ${o.url}  ${o.error}`);
      }
      process.stdout.write(`${lines.join("\n")}\n`);
      if (written === 0) cmd.error(`Error: all ${failed} scrapes failed.`);
    });
}
