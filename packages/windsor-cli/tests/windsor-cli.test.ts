import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildProgram, dateParams, queryParams } from "../src/cli.ts";
import { render } from "../src/format.ts";
import { parseWhere } from "../src/where.ts";

describe("parseWhere", () => {
  test("single comparison", () => {
    expect(parseWhere(["spend > 100"])).toEqual([["spend", "gt", 100]]);
  });

  test("operators map to Windsor names", () => {
    expect(parseWhere(["a = 'x' and b != 2 and c <> 3 and d >= 4 and e <= 5 and f < 6"])).toEqual([
      ["a", "eq", "x"],
      "and",
      ["b", "neq", 2],
      "and",
      ["c", "neq", 3],
      "and",
      ["d", "gte", 4],
      "and",
      ["e", "lte", 5],
      "and",
      ["f", "lt", 6],
    ]);
  });

  test("and binds tighter than or", () => {
    expect(parseWhere(["a = 1 and b = 2 or c = 3"])).toEqual([
      [["a", "eq", 1], "and", ["b", "eq", 2]],
      "or",
      ["c", "eq", 3],
    ]);
  });

  test("parentheses group", () => {
    expect(parseWhere(["(campaign = 'foobar' or spend = 10) and campaign = 'abc (us)'"])).toEqual([
      [["campaign", "eq", "foobar"], "or", ["spend", "eq", 10]],
      "and",
      ["campaign", "eq", "abc (us)"],
    ]);
  });

  test("contains, like, not like, is null, is not null", () => {
    expect(
      parseWhere([
        "a contains 'Sale' and b like '%promo%' and c not like 'test%' and d is null and e is not null",
      ]),
    ).toEqual([
      ["a", "contains", "Sale"],
      "and",
      ["b", "contains", "promo"],
      "and",
      ["c", "ncontains", "test"],
      "and",
      ["d", "null", null],
      "and",
      ["e", "notnull", null],
    ]);
  });

  test("case-insensitive keywords, bare-word and escaped-quote values", () => {
    expect(parseWhere(["country = US AND name = 'it''s' OR x CONTAINS y"])).toEqual([
      [["country", "eq", "US"], "and", ["name", "eq", "it's"]],
      "or",
      ["x", "contains", "y"],
    ]);
  });

  test("multiple expressions are ANDed", () => {
    expect(parseWhere(["spend > 100", "clicks >= 5"])).toEqual([
      ["spend", "gt", 100],
      "and",
      ["clicks", "gte", 5],
    ]);
  });

  test("rejects LIKE wildcards Windsor cannot express", () => {
    expect(() => parseWhere(["a like 'x%y'"])).toThrow(/LIKE only supports/);
  });

  test("rejects malformed input", () => {
    expect(() => parseWhere(["spend >"])).toThrow(/expected a value/);
    expect(() => parseWhere(["(spend > 1"])).toThrow(/missing \)/);
    expect(() => parseWhere(["spend 100"])).toThrow(/expected an operator/);
    expect(() => parseWhere(["a = 'x"])).toThrow(/Unterminated/);
  });
});

describe("dateParams", () => {
  test("relative ranges become presets", () => {
    expect(dateParams()).toEqual({ date_preset: "last_30d" });
    expect(dateParams("90d")).toEqual({ date_preset: "last_90d" });
    expect(dateParams("7dT")).toEqual({ date_preset: "last_7dT" });
    expect(dateParams("this_month")).toEqual({ date_preset: "this_month" });
  });

  test("absolute dates", () => {
    expect(dateParams("2026-01-01", "2026-03-31")).toEqual({ date_from: "2026-01-01", date_to: "2026-03-31" });
    expect(dateParams("2026-01-01")).toEqual({ date_from: "2026-01-01" });
  });

  test("--until needs a --since date", () => {
    expect(() => dateParams("30d", "2026-03-31")).toThrow(/--until needs/);
    expect(() => dateParams("yesterday")).toThrow(/Invalid --since/);
  });
});

describe("queryParams", () => {
  test("builds fields, dates, filter, accounts, limit, and extra params", () => {
    expect(
      queryParams({
        fields: "date, campaign,spend",
        where: ["spend > 100"],
        since: "90d",
        accounts: "1, 2",
        limit: "50",
        param: ["include_inactive=true"],
      }),
    ).toEqual({
      fields: "date,campaign,spend",
      date_preset: "last_90d",
      filter: '[["spend","gt",100]]',
      select_accounts: "1,2",
      _max_rows: "50",
      include_inactive: "true",
    });
  });

  test("guards bad input", () => {
    expect(() => queryParams({ fields: " , " })).toThrow(/at least one field/);
    expect(() => queryParams({ fields: "a", where: ["a = 1"], filter: "[]" })).toThrow(/not both/);
    expect(() => queryParams({ fields: "a", filter: "nope" })).toThrow(/filter JSON/);
    expect(() => queryParams({ fields: "a", limit: "ten" })).toThrow(/--limit/);
    expect(() => queryParams({ fields: "a", param: ["api_key=x"] })).toThrow(/api_key/);
    expect(() => queryParams({ fields: "a", param: ["novalue"] })).toThrow(/key=value/);
  });
});

describe("render", () => {
  const rows = [
    { a: 1, b: 'say "hi", ok' },
    { a: 2, b: null },
  ];
  test("csv quotes and blanks", () => {
    expect(render(rows, "csv")).toBe('a,b\n1,"say ""hi"", ok"\n2,');
  });
  test("jsonl", () => {
    expect(render(rows, "jsonl")).toBe('{"a":1,"b":"say \\"hi\\", ok"}\n{"a":2,"b":null}');
  });
  test("table cuts long cells", () => {
    const table = render([{ d: "x".repeat(200) }], "table");
    expect(table.split("\n")[2]!.length).toBe(80);
  });
});

describe("buildProgram", () => {
  test("registers the read-only commands", () => {
    const names = buildProgram().commands.map((c) => c.name());
    expect(names).toEqual(["connectors", "accounts", "fields", "options", "custom-fields", "query"]);
  });

  test("buildProgram() is independent across calls", () => {
    expect(buildProgram()).not.toBe(buildProgram());
  });
});

describe("query against a mocked Windsor", () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.WINDSOR_API_KEY;
  const realLog = console.log;
  let requested: URL[] = [];
  let printed: string[] = [];

  beforeEach(() => {
    requested = [];
    printed = [];
    process.env.WINDSOR_API_KEY = "test-key";
    console.log = (s: string) => printed.push(s);
    globalThis.fetch = (async (input: URL) => {
      requested.push(new URL(input.toString()));
      return new Response(JSON.stringify({ data: [{ date: "2026-10-01", spend: 12.5 }] }));
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    console.log = realLog;
    if (realKey === undefined) delete process.env.WINDSOR_API_KEY;
    else process.env.WINDSOR_API_KEY = realKey;
  });

  test("sends the filter and renders csv", async () => {
    await buildProgram().parseAsync(
      ["query", "google_ads", "-F", "date,spend", "-w", "spend > 10", "-f", "csv"],
      { from: "user" },
    );
    const url = requested[0]!;
    expect(url.pathname).toBe("/google_ads");
    expect(url.searchParams.get("filter")).toBe('[["spend","gt",10]]');
    expect(url.searchParams.get("_renderer")).toBe("json");
    expect(printed.join("\n")).toBe("date,spend\n2026-10-01,12.5");
  });

  test("--explain prints the URL without calling Windsor or leaking the key", async () => {
    await buildProgram().parseAsync(["query", "google_ads", "-F", "spend", "--explain"], { from: "user" });
    expect(requested).toHaveLength(0);
    expect(printed[0]).toContain("api_key=***");
    expect(printed[0]).not.toContain("test-key");
  });

  test("Windsor errors surface as thrown errors", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "Not authorized" }), { status: 401 })) as unknown as typeof fetch;
    await expect(
      buildProgram().parseAsync(["query", "google_ads", "-F", "spend"], { from: "user" }),
    ).rejects.toThrow(/Not authorized/);
  });
});
