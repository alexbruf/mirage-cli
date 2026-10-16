import { afterEach, describe, expect, test } from "bun:test";
import { runCommander } from "@mirage-cli/core";
import { buildProgram } from "../src/index.ts";
import {
  fetchCrawlResults,
  planCrawlFiles,
  relativePagePath,
  writeCrawlResults,
} from "../src/crawl-results.ts";

const dec = new TextDecoder();

function doc(url: string, markdown: string, title = "T") {
  return { markdown, metadata: { sourceURL: url, title, statusCode: 200 } };
}

function fakeFetch(pages: Record<string, unknown>, seen: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push(url);
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer fc-test");
    const body = pages[url];
    if (!body) return new Response(JSON.stringify({ error: "Job not found" }), { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

const API = "https://api.firecrawl.dev/v2/crawl";

describe("relativePagePath", () => {
  test("mirrors host and path", () => {
    expect(relativePagePath("https://acme.com/blog/post", 0)).toBe("acme.com/blog/post.md");
    expect(relativePagePath("https://acme.com/", 0)).toBe("acme.com/index.md");
    expect(relativePagePath("https://acme.com", 0)).toBe("acme.com/index.md");
    expect(relativePagePath("https://acme.com/docs/", 0)).toBe("acme.com/docs/index.md");
  });

  test("keeps query variants apart and cleans unsafe characters", () => {
    const a = relativePagePath("https://acme.com/list?page=2", 0);
    const b = relativePagePath("https://acme.com/list?page=3", 0);
    expect(a).toMatch(/^acme\.com\/list__[0-9a-f]{8}\.md$/);
    expect(a).not.toBe(b);
    expect(relativePagePath("https://acme.com/a%20b/../c", 0)).toBe("acme.com/c.md");
    expect(relativePagePath("https://acme.com/caf%C3%A9 menu", 0)).toBe("acme.com/caf-menu.md");
  });

  test("falls back when the URL is missing", () => {
    expect(relativePagePath(undefined, 2)).toBe("_unknown/page-3.md");
  });
});

describe("fetchCrawlResults", () => {
  test("follows next and collects every page", async () => {
    const seen: string[] = [];
    const fetchImpl = fakeFetch(
      {
        [`${API}/job-1`]: {
          id: "job-1",
          status: "completed",
          total: 3,
          completed: 3,
          creditsUsed: 3,
          next: `${API}/job-1?skip=2`,
          data: [doc("https://acme.com/", "# Home"), doc("https://acme.com/about", "# About")],
        },
        [`${API}/job-1?skip=2`]: {
          id: "job-1",
          status: "completed",
          total: 3,
          completed: 3,
          next: null,
          data: [doc("https://acme.com/blog/post", "# Post")],
        },
      },
      seen,
    );
    const r = await fetchCrawlResults("job-1", { apiKey: "fc-test", fetchImpl });
    expect(seen).toEqual([`${API}/job-1`, `${API}/job-1?skip=2`]);
    expect(r.status).toBe("completed");
    expect(r.creditsUsed).toBe(3);
    expect(r.pages.map((p) => p.markdown)).toEqual(["# Home", "# About", "# Post"]);
  });

  test("--max-pages stops early", async () => {
    const seen: string[] = [];
    const fetchImpl = fakeFetch(
      {
        [`${API}/job-1`]: {
          id: "job-1",
          status: "completed",
          total: 3,
          completed: 3,
          next: `${API}/job-1?skip=2`,
          data: [doc("https://acme.com/", "a"), doc("https://acme.com/b", "b")],
        },
      },
      seen,
    );
    const r = await fetchCrawlResults("job-1", { apiKey: "fc-test", maxPages: 1, fetchImpl });
    expect(r.pages).toHaveLength(1);
    expect(seen).toHaveLength(1);
  });

  test("surfaces API errors", async () => {
    await expect(
      fetchCrawlResults("missing", { apiKey: "fc-test", fetchImpl: fakeFetch({}) }),
    ).rejects.toThrow(/HTTP 404 for job missing: Job not found/);
  });
});

describe("writeCrawlResults", () => {
  const g = globalThis as typeof globalThis & { __MIRAGE_CLI_FILE_IO__?: unknown };
  afterEach(() => {
    delete g.__MIRAGE_CLI_FILE_IO__;
  });

  test("writes pages and _index.json through the Mirage bridge", async () => {
    const writes = new Map<string, string>();
    g.__MIRAGE_CLI_FILE_IO__ = {
      canHandle: (p: unknown) => String(p).startsWith("/data/"),
      writeFileSync: (p: unknown, data: unknown) => {
        writes.set(String(p), dec.decode(data as Uint8Array));
        return true;
      },
    };
    const manifest = await writeCrawlResults(
      {
        id: "job-1",
        status: "completed",
        total: 3,
        completed: 3,
        pages: [
          doc("https://acme.com/", "# Home"),
          doc("https://acme.com/blog/post", "# Post"),
          doc("https://acme.com/blog/post#top", "# Post again"),
        ],
      },
      "/data/crawls/acme/",
    );
    expect([...writes.keys()].sort()).toEqual([
      "/data/crawls/acme/_index.json",
      "/data/crawls/acme/acme.com/blog/post-2.md",
      "/data/crawls/acme/acme.com/blog/post.md",
      "/data/crawls/acme/acme.com/index.md",
    ]);
    expect(writes.get("/data/crawls/acme/acme.com/blog/post.md")).toBe("# Post");
    const index = JSON.parse(writes.get("/data/crawls/acme/_index.json") as string);
    expect(index.pages[0]).toEqual({
      url: "https://acme.com/",
      file: "acme.com/index.md",
      title: "T",
      statusCode: 200,
      bytes: 6,
    });
    expect(manifest).toHaveLength(3);
  });

  test("planCrawlFiles falls back to html when there is no markdown", () => {
    const { files } = planCrawlFiles({
      id: "j",
      status: "completed",
      total: 1,
      completed: 1,
      pages: [{ html: "<p>x</p>", metadata: { url: "https://acme.com/x" } }],
    });
    expect(files).toEqual([{ path: "acme.com/x.md", body: "<p>x</p>" }]);
  });
});

describe("crawl-results command", () => {
  test("is registered and documented in help", async () => {
    const program = await buildProgram();
    const r = await runCommander(program, ["crawl-results", "--help"]);
    expect(r.exitCode).toBe(0);
    const out = dec.decode(r.stdout);
    expect(out).toContain("crawl-results [options] <job-id>");
    expect(out).toContain("--dir <path>");
  });

  test("prints JSON pages using the global --api-key", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch({
      [`${API}/job-9`]: {
        id: "job-9",
        status: "completed",
        total: 1,
        completed: 1,
        data: [doc("https://acme.com/", "# Home")],
      },
    });
    try {
      const program = await buildProgram();
      const r = await runCommander(program, ["--api-key", "fc-test", "crawl-results", "job-9"]);
      expect(dec.decode(r.stderr)).toBe("");
      expect(r.exitCode).toBe(0);
      const body = JSON.parse(dec.decode(r.stdout));
      expect(body.pages[0].markdown).toBe("# Home");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("reports API errors with a non-zero exit", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch({});
    try {
      const program = await buildProgram();
      const r = await runCommander(program, ["crawl-results", "nope", "-k", "fc-test"]);
      expect(r.exitCode).not.toBe(0);
      expect(dec.decode(r.stderr)).toContain("HTTP 404");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
