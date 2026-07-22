import { describe, expect, test } from "bun:test";
import {
  BoundedMinHeap,
  SERVER_ROW_CAP,
  gscCompare,
  gscTopBy,
  normalizeGscPage,
  pageHasMore,
  parseGscTsv,
  type GscPageArgs,
  type GscPager,
  type GscRow,
} from "../src/gsc-top.ts";
import { renderOutput } from "../src/output.ts";

function pagerFromWindows(windows: Record<string, GscRow[]>): GscPager & { calls: GscPageArgs[] } {
  const calls: GscPageArgs[] = [];
  return {
    calls,
    async getGscPage(args) {
      calls.push(args);
      const key = `${args.start_date}:${args.end_date}`;
      return { rows: windows[key] ?? [], envelope: {} };
    },
  };
}

describe("SEO Gets GSC payload normalization", () => {
  test("parses TSV stored inside a JSON data field into typed rows", () => {
    const payload = {
      data: [
        "Query\tClicks\tImpressions\tCTR\tPosition",
        "flat roof repair\t0\t214\t0\t8.5",
        "roofing company\t12\t1,200\t20.87\t3.2",
      ].join("\n"),
      pagination: { page: 1, total_pages: 3 },
    };

    expect(normalizeGscPage(payload).rows).toEqual([
      { query: "flat roof repair", clicks: 0, impressions: 214, ctr: 0, position: 8.5 },
      { query: "roofing company", clicks: 12, impressions: 1200, ctr: 20.87, position: 3.2 },
    ]);
  });

  test("parses JSON text and fenced TSV variants", () => {
    expect(normalizeGscPage(JSON.stringify({ data: "Page\tClicks\n/a\t2" })).rows).toEqual([
      { page: "/a", clicks: 2 },
    ]);
    expect(parseGscTsv("```tsv\nQuery\tImpressions\nroofer\t10\n```")).toEqual([
      { query: "roofer", impressions: 10 },
    ]);
  });

  test("rejects unsupported non-tabular payloads instead of silently returning no rows", () => {
    expect(() => normalizeGscPage({ data: "not a table" })).toThrow("unsupported payload");
  });

  test("uses explicit pagination metadata before page-size fallback", () => {
    expect(pageHasMore({ pagination: { total_pages: 3 } }, 1, 1000, 1)).toBe(true);
    expect(pageHasMore({ pagination: { total_pages: 3 } }, 1, 1000, 3)).toBe(false);
    expect(pageHasMore({}, 1000, 1000, 1)).toBe(true);
    expect(pageHasMore({}, 999, 1000, 1)).toBe(false);
  });
});

describe("BoundedMinHeap", () => {
  test("retains only the best N values and drains in deterministic best-first order", () => {
    const heap = new BoundedMinHeap<number>(3, (left, right) => left - right);
    for (const value of [8, 3, 5, 1, 9, 2]) heap.offer(value);
    expect(heap.drainSorted()).toEqual([1, 2, 3]);
  });
});

describe("gscTopBy", () => {
  test("makes one un-paginated request and ranks the full window by the metric", async () => {
    const pager = pagerFromWindows({
      "2026-06-28:2026-07-12": [
        { query: "click winner", clicks: 20, impressions: 100 },
        { query: "second", clicks: 10, impressions: 90 },
        { query: "third", clicks: 5, impressions: 80 },
        { query: "flat roof repair", clicks: 0, impressions: 214 },
      ],
    });

    const result = await gscTopBy(pager, {
      site: "example.com",
      startDate: "2026-06-28",
      endDate: "2026-07-12",
      dimension: "query",
      metric: "impressions",
      limit: 3,
      brandedQueries: false,
    });

    expect(result.rows.map((row) => row.query)).toEqual([
      "flat roof repair",
      "click winner",
      "second",
    ]);
    expect(result).toMatchObject({ pagesFetched: 1, rowsScanned: 4, truncatedByCap: false });
    expect(pager.calls).toHaveLength(1);
    expect(pager.calls[0]).toEqual({
      site: "example.com",
      start_date: "2026-06-28",
      end_date: "2026-07-12",
      dimensions: ["query"],
      branded_queries: false,
    });
    expect(pager.calls[0]).not.toHaveProperty("page");
    expect(pager.calls[0]).not.toHaveProperty("page_size");
  });

  test("sorts position ascending and resolves metric ties by label", async () => {
    const pager = pagerFromWindows({
      "a:b": [
        { page: "/z", position: 2 },
        { page: "/b", position: 1 },
        { page: "/a", position: 1 },
      ],
    });

    const result = await gscTopBy(pager, {
      site: "example.com",
      startDate: "a",
      endDate: "b",
      dimension: "page",
      metric: "position",
      limit: 3,
    });
    expect(result.rows.map((row) => row.page)).toEqual(["/a", "/b", "/z"]);
  });

  test("reports truncation when the response hits the server row cap", async () => {
    const rows: GscRow[] = Array.from({ length: SERVER_ROW_CAP }, (_, index) => ({
      query: `q${index}`,
      impressions: 1,
    }));
    const pager: GscPager = {
      async getGscPage() {
        return { rows, envelope: {} };
      },
    };
    const result = await gscTopBy(pager, {
      site: "example.com",
      startDate: "a",
      endDate: "b",
      dimension: "query",
      metric: "impressions",
      limit: 5,
    });
    expect(result).toMatchObject({
      pagesFetched: 1,
      rowsScanned: SERVER_ROW_CAP,
      truncatedByCap: true,
    });
  });
});

describe("gscCompare", () => {
  test("finds an exact query in both windows and calculates deltas", async () => {
    const pager = pagerFromWindows({
      "current:start": [
        { query: "other", impressions: 100 },
        { query: "target", impressions: 60 },
      ],
      "prior:start": [
        { query: "other", impressions: 90 },
        { query: "target", impressions: 40 },
      ],
    });

    const result = await gscCompare(pager, {
      site: "example.com",
      query: "target",
      currentStart: "current",
      currentEnd: "start",
      compareStart: "prior",
      compareEnd: "start",
      metric: "impressions",
    });

    expect(result).toEqual({
      label: "target",
      current: 60,
      prior: 40,
      delta_abs: 20,
      delta_pct: 50,
      found: true,
      found_current: true,
      found_prior: true,
      truncated: false,
    });
  });

  test("returns a null percentage when the prior value is zero", async () => {
    const pager = pagerFromWindows({
      "current:start": [{ query: "target", clicks: 2 }],
      "prior:start": [{ query: "target", clicks: 0 }],
    });
    const result = await gscCompare(pager, {
      site: "example.com",
      query: "target",
      currentStart: "current",
      currentEnd: "start",
      compareStart: "prior",
      compareEnd: "start",
      metric: "clicks",
    });
    expect(result.delta_pct).toBeNull();
  });
});

describe("rows-only output", () => {
  const rows = [
    { query: "flat roof repair", impressions: 214 },
    { query: "roofer", impressions: 100 },
  ];

  test("renders clean row JSON with no metadata envelope", () => {
    expect(JSON.parse(renderOutput(rows, "json"))).toEqual(rows);
  });

  test("renders clean CSV with a deterministic header", () => {
    expect(renderOutput(rows, "csv")).toBe(
      '"query","impressions"\n"flat roof repair","214"\n"roofer","100"',
    );
  });
});
