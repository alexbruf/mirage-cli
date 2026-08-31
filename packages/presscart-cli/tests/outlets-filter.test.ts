import { describe, expect, spyOn, test } from "bun:test";
import type { ApiClient, RequestOptions } from "../src/client.ts";
import { listOutlets, type ListOutletsOpts } from "../src/commands/outlets.ts";

const pages: Record<number, Record<string, unknown>[]> = {
  1: [
    {
      id: "miami",
      name: "The Miami Herald",
      outlet_name: "Miami Herald",
      website_url: "https://miami.example",
      country: "United States",
      state: "Florida",
      city: "Miami",
      tags: [{ name: "Newspaper" }],
      prices: [{ unit_amount: 225, currency: "usd" }],
    },
    {
      id: "toronto",
      name: "Toronto Daily",
      outlet_name: "Toronto Daily",
      website_url: "https://toronto.example",
      country: "Canada",
      state: "Ontario",
      city: "Toronto",
      tags: [{ name: "Business" }],
      prices: [
        { unit_amount: 4500, currency: "usd", pricing_tier: "premium" },
        { unit_amount: 3500, currency: "usd", pricing_tier: "basic" },
      ],
    },
  ],
  2: [
    // Page overlap is deliberate: catalog pagination must dedupe listing IDs.
    {
      id: "toronto",
      name: "Toronto Daily",
      country: "Canada",
      state: "Ontario",
      city: "Toronto",
      tags: [{ name: "Business" }],
      prices: [{ unit_amount: 3500, currency: "usd" }],
    },
    {
      id: "vancouver",
      name: "Vancouver Sun",
      outlet_name: "The Vancouver Sun",
      website_url: "https://vancouver.example",
      country: "Canada",
      state: "British Columbia",
      city: "Vancouver",
      tags: [{ name: "News" }],
      prices: [
        { unit_amount: 600, currency: "usd", pricing_tier: "premium" },
        { unit_amount: 275, currency: "usd", pricing_tier: "basic" },
      ],
    },
    {
      id: "unpriced",
      name: "Unpriced Outlet",
      country: "United States",
      state: "New York",
      city: "New York",
      tags: [{ name: "News" }],
      prices: [],
    },
  ],
};

function stubClient(calls: RequestOptions[]): Pick<ApiClient, "request"> {
  return {
    request: (async <T>(_path: string, options: RequestOptions = {}) => {
      calls.push(options);
      const page = typeof options.query?.page === "number" ? options.query.page : 1;
      return {
        records: pages[page] ?? [],
        total_records: 4,
        total_pages: 2,
        page,
      } as T;
    }) as ApiClient["request"],
  };
}

async function runList(opts: ListOutletsOpts): Promise<{
  rows: Record<string, unknown>[];
  stderr: string;
  calls: RequestOptions[];
}> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const calls: RequestOptions[] = [];
  const stdoutSpy = spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  const stderrSpy = spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });

  try {
    await listOutlets({ ...opts, format: "json" }, stubClient(calls));
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }

  return {
    rows: JSON.parse(stdout.join("")) as Record<string, unknown>[],
    stderr: stderr.join(""),
    calls,
  };
}

describe("outlet list client-side filters", () => {
  test("a search with no matches returns zero rows", async () => {
    const result = await runList({ search: "zzzznotarealoutlet", limit: 2 });

    expect(result.rows).toEqual([]);
    expect(result.stderr).toContain(
      '# 0 outlet listings matching "zzzznotarealoutlet" of 4 total',
    );
  });

  test("searches the full catalog before applying limit", async () => {
    const result = await runList({ search: "VANCOUVER", limit: 1 });

    expect(result.rows.map((row) => row.id)).toEqual(["vancouver"]);
    expect(result.calls).toHaveLength(2);
    expect(result.calls.map((call) => call.query)).toEqual([
      { limit: 1000, page: 1 },
      { limit: 1000, page: 2 },
    ]);
  });

  test("filters country case-insensitively and dedupes paged listing IDs", async () => {
    const result = await runList({ country: "canada" });

    expect(result.rows.map((row) => row.id)).toEqual(["toronto", "vancouver"]);
  });

  test("filters state, city, and tag case-insensitively", async () => {
    const byState = await runList({ state: "florida" });
    const byCity = await runList({ city: "MIAMI" });
    const byTag = await runList({ tag: "news" });

    expect(byState.rows.map((row) => row.id)).toEqual(["miami"]);
    expect(byCity.rows.map((row) => row.id)).toEqual(["miami"]);
    expect(byTag.rows.map((row) => row.id)).toEqual(["vancouver", "unpriced"]);
  });

  // Silently answering page 1 for --page 2 is the same class of bug this change
  // exists to fix, so both the honoured and the refused case are locked in.
  test("pages over matches rather than ignoring --page", async () => {
    const page1 = await runList({ country: "canada", limit: 1 });
    const page2 = await runList({ country: "canada", limit: 1, page: 2 });
    const page3 = await runList({ country: "canada", limit: 1, page: 3 });

    expect(page1.rows.map((row) => row.id)).toEqual(["toronto"]);
    expect(page2.rows.map((row) => row.id)).toEqual(["vancouver"]);
    expect(page3.rows).toEqual([]);
    expect(page2.stderr).toContain("1 outlet listings shown (page 2) of 2");
  });

  test("refuses --page without --limit when filtering, instead of assuming page 1", async () => {
    await expect(runList({ country: "canada", page: 2 })).rejects.toThrow(
      "--page needs --limit when a filter is active",
    );
  });

  test("keeps listings whose nested price is within the budget", async () => {
    const result = await runList({ minPrice: 200, maxPrice: 300 });

    expect(result.rows.map((row) => row.id)).toEqual(["miami", "vancouver"]);
    expect(result.rows.map((row) => row.price_usd)).toEqual(["$225", "$275"]);
    expect(result.stderr).toContain("(1 excluded: no price)");
  });
});
