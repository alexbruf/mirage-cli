import { afterEach, describe, expect, test } from "bun:test";
import { runCommander } from "@mirage-cli/core";
import { buildProgram } from "../src/index.ts";
import { parseUrlList, scrapeMany, writeScrapeResults } from "../src/scrape-many.ts";

const dec = new TextDecoder();
const g = globalThis as typeof globalThis & { __MIRAGE_CLI_FILE_IO__?: unknown };

/** Fake POST /v2/scrape: `pages` maps a URL to its markdown; others 500. */
function fakeScrape(pages: Record<string, string>, bodies: unknown[] = []): typeof fetch {
  let inFlight = 0;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe("https://api.firecrawl.dev/v2/scrape");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer fc-test");
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    inFlight++;
    (fakeScrape as unknown as { peak: number }).peak = Math.max(
      (fakeScrape as unknown as { peak?: number }).peak ?? 0,
      inFlight,
    );
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    const md = pages[body.url];
    if (md === undefined) {
      return new Response(JSON.stringify({ success: false, error: "boom" }), { status: 500 });
    }
    return new Response(
      JSON.stringify({ success: true, data: { markdown: md, metadata: { title: md } } }),
    );
  }) as typeof fetch;
}

function bridgeWrites(reads: Record<string, string> = {}) {
  const writes = new Map<string, string>();
  g.__MIRAGE_CLI_FILE_IO__ = {
    canHandle: (p: unknown) => String(p).startsWith("/data/"),
    readFileSync: (p: unknown) => reads[String(p)] ?? null,
    writeFileSync: (p: unknown, data: unknown) => {
      writes.set(String(p), dec.decode(data as Uint8Array));
      return true;
    },
  };
  return writes;
}

afterEach(() => {
  delete g.__MIRAGE_CLI_FILE_IO__;
});

describe("parseUrlList", () => {
  test("reads one URL per line and skips blanks and comments", () => {
    expect(parseUrlList("https://a.com/x\n\n# note\r\n  https://a.com/y  \n")).toEqual([
      "https://a.com/x",
      "https://a.com/y",
    ]);
  });
});

describe("scrapeMany", () => {
  test("keeps input order, caps concurrency and passes scrape options", async () => {
    const bodies: Record<string, unknown>[] = [];
    const urls = Array.from({ length: 6 }, (_, i) => `https://a.com/p${i}`);
    const pages = Object.fromEntries(urls.map((u) => [u, `# ${u}`]));
    (fakeScrape as unknown as { peak: number }).peak = 0;
    const out = await scrapeMany(urls, {
      apiKey: "fc-test",
      concurrency: 2,
      onlyMainContent: true,
      maxAge: 1000,
      fetchImpl: fakeScrape(pages, bodies),
    });
    expect(out.map((o) => o.url)).toEqual(urls);
    expect(out.every((o) => o.doc?.markdown === `# ${o.url}`)).toBe(true);
    expect((fakeScrape as unknown as { peak: number }).peak).toBe(2);
    expect(bodies[0]).toMatchObject({ formats: ["markdown"], onlyMainContent: true, maxAge: 1000 });
  });

  test("records failures without stopping the rest", async () => {
    const out = await scrapeMany(["https://a.com/ok", "https://a.com/bad"], {
      apiKey: "fc-test",
      fetchImpl: fakeScrape({ "https://a.com/ok": "# ok" }),
    });
    expect(out[0]?.doc?.markdown).toBe("# ok");
    expect(out[1]?.error).toBe("HTTP 500: boom");
  });
});

describe("writeScrapeResults", () => {
  test("writes pages and lists failures in _index.json", async () => {
    const writes = bridgeWrites();
    const r = await writeScrapeResults(
      [
        { url: "https://a.com/", doc: { markdown: "# home", metadata: { sourceURL: "https://a.com/" } } },
        { url: "https://a.com/bad", error: "HTTP 500: boom" },
      ],
      "/data/pages",
    );
    expect(r).toEqual({ written: 1, failed: 1 });
    expect(writes.get("/data/pages/a.com/index.md")).toBe("# home");
    const index = JSON.parse(writes.get("/data/pages/_index.json") as string);
    expect(index.failed).toEqual([{ url: "https://a.com/bad", error: "HTTP 500: boom" }]);
    expect(index.pages[0].file).toBe("a.com/index.md");
  });
});

describe("scrape-many command", () => {
  test("scrapes arguments plus --urls-file into --dir", async () => {
    const writes = bridgeWrites({ "/data/urls.txt": "https://a.com/b\nhttps://a.com/a\n" });
    const origFetch = globalThis.fetch;
    globalThis.fetch = fakeScrape({ "https://a.com/a": "# A", "https://a.com/b": "# B" });
    try {
      const program = await buildProgram();
      const r = await runCommander(program, [
        "scrape-many",
        "https://a.com/a",
        "--urls-file",
        "/data/urls.txt",
        "--dir",
        "/data/out",
        "-k",
        "fc-test",
      ]);
      expect(dec.decode(r.stderr)).toBe("");
      expect(r.exitCode).toBe(0);
      expect(dec.decode(r.stdout)).toContain("Wrote 2 of 2 pages to /data/out/");
      expect(writes.get("/data/out/a.com/a.md")).toBe("# A");
      expect(writes.get("/data/out/a.com/b.md")).toBe("# B");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("fails when every scrape fails, and rejects non-URLs before spending", async () => {
    bridgeWrites();
    const origFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      calls++;
      return fakeScrape({})(...args);
    }) as typeof fetch;
    try {
      const program = await buildProgram();
      const bad = await runCommander(program, ["scrape-many", "nota url", "--dir", "/data/x", "-k", "fc-test"]);
      expect(bad.exitCode).not.toBe(0);
      expect(dec.decode(bad.stderr)).toContain("not a URL");
      expect(calls).toBe(0);

      const r = await runCommander(program, ["scrape-many", "https://a.com/x", "--dir", "/data/x", "-k", "fc-test"]);
      expect(r.exitCode).not.toBe(0);
      expect(dec.decode(r.stderr)).toContain("all 1 scrapes failed");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("requires --dir", async () => {
    const program = await buildProgram();
    const r = await runCommander(program, ["scrape-many", "https://a.com/x", "-k", "fc-test"]);
    expect(r.exitCode).not.toBe(0);
    expect(dec.decode(r.stderr)).toContain("--dir");
  });
});
