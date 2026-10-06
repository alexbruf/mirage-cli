import { describe, expect, test } from "bun:test";
import {
  changeRows,
  collectPages,
  listRows,
  pageRows,
  performanceRows,
  performanceWarnings,
  queryRows,
} from "../src/site-data.ts";

// Fixtures follow response shapes captured from the live server on 2026-10-06.
const BOILERPLATE =
  "Use only the data included in the response for your analysis. Provide exact values as given.";

describe("performanceRows", () => {
  test("parses merged GSC + GA4 TSV into typed rows with camelCase GA4 columns", () => {
    const rows = performanceRows({
      currency: "USD",
      data:
        "date\tclicks\timpressions\tctr\tposition\tactiveUsers\tsessions\tengagedSessions\tengagementRate\tkeyEvents\trevenue\n" +
        "2026-09-01\t183\t6619\t2.76\t8.01\t808\t913\t357\t39.10\t25\t0.00",
      note: BOILERPLATE,
      property: "sc-domain:example.com",
      sources: "search=gsc, web=ga4",
    });
    expect(rows).toEqual([
      {
        date: "2026-09-01",
        clicks: 183,
        impressions: 6619,
        ctr: 2.76,
        position: 8.01,
        activeUsers: 808,
        sessions: 913,
        engagedSessions: 357,
        engagementRate: 39.1,
        keyEvents: 25,
        revenue: 0,
      },
    ]);
  });

  test("parses a GA4-only table with no search columns", () => {
    const rows = performanceRows({
      data: "sessionSourceMedium\tsessions\ngoogle / organic\t120",
      property: "sc-domain:example.com",
    });
    expect(rows).toEqual([{ sessionSourceMedium: "google / organic", sessions: 120 }]);
  });

  test("keeps the portfolio site dimension", () => {
    const rows = performanceRows({
      data: "site\tclicks\timpressions\nsc-domain:example.com\t116\t10466",
      portfolio: "Example",
    });
    expect(rows).toEqual([{ site: "sc-domain:example.com", clicks: 116, impressions: 10466 }]);
  });
});

describe("performanceWarnings", () => {
  test("drops the boilerplate note", () => {
    expect(performanceWarnings({ note: BOILERPLATE })).toEqual([]);
  });

  test("keeps the specific part of a note and lists skipped sites", () => {
    expect(
      performanceWarnings({
        note: `sc-domain:a.com: GA4 request failed, web metrics are not included in this response. ${BOILERPLATE}`,
        skipped_sites: ["sc-domain:b.com (no access)"],
      }),
    ).toEqual([
      "sc-domain:a.com: GA4 request failed, web metrics are not included in this response.",
      "skipped sites: sc-domain:b.com (no access)",
    ]);
  });
});

describe("list flattening", () => {
  test("pageRows joins host and path without a double slash", () => {
    expect(
      pageRows({
        hosts: [{ host: "https://example.com/", paths: ["/", "/events/"] }],
      }),
    ).toEqual([
      { url: "https://example.com/", host: "https://example.com", path: "/" },
      { url: "https://example.com/events/", host: "https://example.com", path: "/events/" },
    ]);
  });

  test("queryRows emits one row per query", () => {
    expect(queryRows({ queries: ["a", "b"] })).toEqual([{ query: "a" }, { query: "b" }]);
    expect(queryRows({ queries: [] })).toEqual([]);
  });

  test("changeRows flattens days into dated items", () => {
    expect(
      changeRows({
        days: [
          {
            date: "2026-09-24",
            items: [{ type: "google_update", title: "September 2026 Spam Update", href: "https://x" }],
          },
        ],
      }),
    ).toEqual([
      { date: "2026-09-24", type: "google_update", title: "September 2026 Spam Update", href: "https://x" },
    ]);
    expect(changeRows({ days: null })).toEqual([]);
  });

  test("listRows reads the named array", () => {
    expect(listRows({ content_groups: [{ name: "Blog" }] }, "content_groups")).toEqual([
      { name: "Blog" },
    ]);
    expect(listRows({}, "topic_clusters")).toEqual([]);
  });
});

describe("collectPages", () => {
  test("stops when has_more is false", async () => {
    const seen: number[] = [];
    const result = await collectPages(
      async (page) => {
        seen.push(page);
        return { has_more: page < 3, queries: [`q${page}`] };
      },
      queryRows,
      1,
    );
    expect(seen).toEqual([1, 2, 3]);
    expect(result).toEqual({
      rows: [{ query: "q1" }, { query: "q2" }, { query: "q3" }],
      pages: 3,
      complete: true,
    });
  });
});
