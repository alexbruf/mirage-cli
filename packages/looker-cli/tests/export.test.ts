import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommander } from "@mirage-cli/core";
import { buildProgram } from "../src/cli.ts";
import { atPath, render, selectRows, toCsv } from "../src/export.ts";

const decoder = new TextDecoder();
const originalFetch = globalThis.fetch;
const BASE = ["--api-key", "lk_test", "--base-url", "https://looker.test"];

function respond(data: unknown, mcp = false): void {
  globalThis.fetch = (async () =>
    mcp
      ? Response.json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(data) }] } })
      : Response.json({ ok: true, data })) as unknown as typeof fetch;
}

async function looker(...argv: string[]) {
  const result = await runCommander(buildProgram(), [...BASE, ...argv]);
  return { ...result, out: decoder.decode(result.stdout), err: decoder.decode(result.stderr) };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete (globalThis as { __MIRAGE_CLI_FILE_IO__?: unknown }).__MIRAGE_CLI_FILE_IO__;
});

describe("csv", () => {
  test("escapes quotes, commas and newlines; flattens nested fields", () => {
    expect(toCsv([
      { keyword: 'best "shoes", cheap', rank: 3, spark: [5, null, 3], tags: [], meta: { a: 1 } },
      { keyword: "line\nbreak", rank: null, extra: true },
    ])).toBe(
      'keyword,rank,spark,tags,meta.a,extra\n"best ""shoes"", cheap",3,5||3,,1,\n"line\nbreak",,,,,true\n',
    );
  });

  test("atPath flattens arrays met along the way", () => {
    const value = { series: [{ points: [{ r: 1 }, { r: 2 }] }, { points: [{ r: 3 }] }] };
    expect(atPath(value, "series.points")).toEqual([{ r: 1 }, { r: 2 }, { r: 3 }]);
    expect(atPath(value, ".")).toBe(value);
  });

  test("without a default, the largest table at the top or under report wins", () => {
    const value = { id: "x", report: { a: [{ k: 1 }], b: [{ k: 1 }, { k: 2 }] } };
    expect(selectRows(value, undefined, undefined)).toEqual({ rows: [{ k: 1 }, { k: 2 }], from: "report.b" });
  });

  test("json stays whole unless --rows is given", () => {
    expect(render({ a: [{ b: 1 }] }, { format: "json" }).text).toBe('{"a":[{"b":1}]}\n');
    expect(render({ a: [{ b: 1 }] }, { format: "json", rowsPath: "a" }).text).toBe('[{"b":1}]\n');
  });
});

describe("commands", () => {
  test("keywords list --format csv prints a header and one line per keyword", async () => {
    respond([{ id: "kw_1", keyword: "a", rank: 4 }, { id: "kw_2", keyword: "b", rank: null }]);
    const r = await looker("--format", "csv", "keywords", "list", "prj_1");
    expect(r.exitCode).toBe(0);
    expect(r.out).toBe("id,keyword,rank\nkw_1,a,4\nkw_2,b,\n");
  });

  test("projects report defaults to its keywords; --rows picks summary", async () => {
    respond({ project: { id: "p" }, summary: { inTop3: 2 }, keywords: [{ keyword: "a" }] });
    expect((await looker("--format", "csv", "projects", "report", "p")).out).toBe("keyword\na\n");
    respond({ project: { id: "p" }, summary: { inTop3: 2 }, keywords: [{ keyword: "a" }] });
    expect((await looker("--format", "csv", "--rows", "summary", "projects", "report", "p")).out).toBe("inTop3\n2\n");
  });

  test("keywords history becomes one row per check", async () => {
    respond({
      keyword: "k",
      series: [{ label: "me.com", isTarget: true, points: [{ date: "2026-10-01", rank: 4 }, { date: "2026-10-02", rank: null, notFound: true }] }],
    });
    const r = await looker("--format", "csv", "keywords", "history", "kw_1");
    expect(r.out).toBe("keyword,series,isTarget,date,rank,notFound\nk,me.com,true,2026-10-01,4,\nk,me.com,true,2026-10-02,,true\n");
  });

  test("gsc performance names keys after the dimensions", async () => {
    respond({ dimensions: ["query", "page"], rows: [{ keys: ["ivf cost", "/a"], clicks: 3, position: 4.2 }] }, true);
    const r = await looker("--format", "csv", "gsc", "performance", "p", "--dimension", "query", "--dimension", "page");
    expect(r.out).toBe("query,page,clicks,position\nivf cost,/a,3,4.2\n");
  });

  test("changes tags each row with its section", async () => {
    respond({ rankMovers: { improved: [{ keyword: "a" }], declined: [{ keyword: "b" }] }, top10: { entered: [], left: [] } }, true);
    const r = await looker("--format", "ndjson", "changes");
    expect(r.out).toBe('{"section":"improved","keyword":"a"}\n{"section":"declined","keyword":"b"}\n');
  });

  test("--output writes the file and prints a summary", async () => {
    respond([{ id: "kw_1", keyword: "a" }]);
    const path = join(mkdtempSync(join(tmpdir(), "looker-")), "nested", "kw.csv");
    const r = await looker("--format", "csv", "--output", path, "keywords", "list", "p");
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.out)).toEqual({ output: path, format: "csv", rows: 1, rows_from: ".", bytes: 18 });
    expect(readFileSync(path, "utf8")).toBe("id,keyword\nkw_1,a\n");
  });

  test("--output goes through the Mirage VFS bridge when it handles the path", async () => {
    respond({ report: { items: [{ keyword: "a", searchVolume: 10 }] } });
    const writes: Array<[unknown, string]> = [];
    (globalThis as { __MIRAGE_CLI_FILE_IO__?: unknown }).__MIRAGE_CLI_FILE_IO__ = {
      canHandle: (p: unknown) => String(p).startsWith("/sessions/"),
      writeFileSync: (p: unknown, data: Uint8Array) => {
        writes.push([p, decoder.decode(data)]);
        return true;
      },
    };
    const r = await looker("--format", "csv", "--output", "/sessions/s1/ideas.csv", "keyword-research", "get", "krr_1");
    expect(r.exitCode).toBe(0);
    expect(writes).toEqual([["/sessions/s1/ideas.csv", "keyword,searchVolume\na,10\n"]]);
    expect(JSON.parse(r.out)).toMatchObject({ rows: 1, rows_from: "report.items" });
  });

  test("an unknown --format fails before any request", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return Response.json({ ok: true, data: [] });
    }) as unknown as typeof fetch;
    const r = await looker("--format", "xlsx", "projects", "list");
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain("--format must be one of json, csv, ndjson");
    expect(called).toBe(false);
  });
});
