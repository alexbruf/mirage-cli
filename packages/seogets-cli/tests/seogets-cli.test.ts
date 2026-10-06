import { afterEach, describe, expect, spyOn, test } from "bun:test";
import packageJson from "../package.json" with { type: "json" };
import { buildProgram } from "../src/cli.ts";
import { McpClient, unwrapToolResult } from "../src/mcp.ts";

async function captureToolCall(
  args: string[],
  result: unknown = {},
): Promise<[string, Record<string, unknown>]> {
  const callTool = spyOn(McpClient.prototype, "callTool").mockResolvedValue(result);
  try {
    await buildProgram().parseAsync(["--token", "test-token", ...args], { from: "user" });
    expect(callTool).toHaveBeenCalledTimes(1);
    return callTool.mock.calls[0] as [string, Record<string, unknown>];
  } finally {
    callTool.mockRestore();
  }
}

function expectPropertyWireKey(args: Record<string, unknown>, site: string): void {
  expect(Object.prototype.hasOwnProperty.call(args, "property")).toBe(true);
  expect(args.property).toBe(site);
  expect(Object.prototype.hasOwnProperty.call(args, "site")).toBe(false);
}

const realFetch = globalThis.fetch;

function stubToolResponse(result: unknown): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("@mirage-cli/seogets-cli", () => {
  test("buildProgram() returns a configured Commander program", () => {
    const program = buildProgram();
    expect(program.name()).toBe("seogets");
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
    expect(program.commands.length).toBeGreaterThan(0);
    const names = program.commands.map((c: { name: () => string }) => c.name());
    expect(names).toContain("tools");
    expect(names).toContain("sites");
    expect(names).toContain("gsc");
    expect(names).toContain("gsc-top");
    expect(names).toContain("gsc-compare");
    expect(names).toContain("indexing");
    expect(names).toContain("call");
  });

  test("buildProgram() exposes the package version", () => {
    const program = buildProgram();
    expect(program.version()).toBe(packageJson.version);
  });

  test("indexing subcommand has overview + status children", () => {
    const program = buildProgram();
    const indexing = program.commands.find(
      (c: { name: () => string }) => c.name() === "indexing",
    ) as { commands: readonly { name: () => string }[] } | undefined;
    expect(indexing).toBeDefined();
    const children = indexing!.commands.map((c) => c.name());
    expect(children).toContain("overview");
    expect(children).toContain("status");
  });

  test("gsc-top defaults to rows-only impression sorting", () => {
    const command = buildProgram().commands.find((candidate) => candidate.name() === "gsc-top");
    expect(command).toBeDefined();
    expect(command!.getOptionValueSource("rowsOnly")).toBe("default");
    expect(command!.getOptionValue("rowsOnly")).toBe(true);
    expect(command!.getOptionValue("dim")).toBe("query");
    expect(command!.getOptionValue("by")).toBe("impressions");
  });

  test("gsc sends the site as the property wire key", async () => {
    const [tool, args] = await captureToolCall([
      "gsc",
      "sc-domain:example.com",
      "2026-08-01",
      "2026-08-25",
    ]);
    expect(tool).toBe("get_site_performance");
    expectPropertyWireKey(args, "sc-domain:example.com");
    expect(args.metrics).toEqual(["clicks", "impressions", "ctr", "position"]);
  });

  test("indexing overview sends the site as the property wire key", async () => {
    const [tool, args] = await captureToolCall([
      "indexing",
      "overview",
      "sc-domain:example.com",
    ]);
    expect(tool).toBe("get_indexing_overview");
    expectPropertyWireKey(args, "sc-domain:example.com");
  });

  test("indexing status sends the site as the property wire key", async () => {
    const [tool, args] = await captureToolCall([
      "indexing",
      "status",
      "sc-domain:example.com",
    ]);
    expect(tool).toBe("get_indexing_status");
    expectPropertyWireKey(args, "sc-domain:example.com");
  });

  test("buildProgram() is independent across calls (no shared state)", () => {
    const a = buildProgram();
    const b = buildProgram();
    expect(a).not.toBe(b);
    expect(a.name()).toBe(b.name());
  });

  test("unwrapToolResult unwraps MCP content envelope", () => {
    expect(unwrapToolResult({ content: [{ type: "text", text: '{"a":1}' }] })).toEqual({ a: 1 });
    expect(unwrapToolResult({ content: [{ type: "text", text: "hello" }] })).toBe("hello");
    expect(unwrapToolResult({ structuredContent: { ok: true } })).toEqual({ ok: true });
    expect(unwrapToolResult({ foo: 42 })).toEqual({ foo: 42 });
  });
});

describe("SEO Gets application-level failures", () => {
  const property = "sc-domain:example.com";
  const failureNote = `No accessible property matched Property="${property}".`;

  test("a note without an echoed property throws the provider note", async () => {
    stubToolResponse({ note: failureNote });

    await expect(
      new McpClient({ token: "test-token" }).callTool("get_indexing_overview", { property }),
    ).rejects.toThrow(failureNote);
  });

  test("indexing status data:null without an echoed property is a failure", async () => {
    stubToolResponse({ data: null, note: failureNote });

    await expect(
      new McpClient({ token: "test-token" }).callTool("get_indexing_status", { property }),
    ).rejects.toThrow(failureNote);
  });

  test("indexing status data:null with an echoed property remains a successful empty result", async () => {
    const result = { data: null, note: "Returned 0 rows.", property };
    stubToolResponse(result);

    await expect(
      new McpClient({ token: "test-token" }).callTool("get_indexing_status", { property }),
    ).resolves.toEqual(result);
  });

  test("GSC performance with a benign note and echoed property remains successful", async () => {
    const result = {
      data: [],
      start_date: "2026-08-01",
      end_date: "2026-08-25",
      note: "Use only the data included in the response.",
      property,
    };
    stubToolResponse(result);

    await expect(
      new McpClient({ token: "test-token" }).callTool("get_site_performance", { property }),
    ).resolves.toEqual(result);
  });

  // Shapes below were captured from the live server on 2026-10-06.
  test("list_site_pages success has a note and no echoed property, and stays successful", async () => {
    const result = {
      has_more: true,
      hosts: [{ host: "https://example.com", paths: ["/", "/events/"] }],
      note: "Returned 2 unique paths across 1 hosts. If you need more data, use the 'page' parameter.",
      page: 1,
      page_size: 2,
    };
    stubToolResponse(result);

    await expect(
      new McpClient({ token: "test-token" }).callTool("list_site_pages", {
        property,
        page: 1,
        page_size: 2,
      }),
    ).resolves.toEqual(result);
  });

  test("an empty past-the-end list page stays successful", async () => {
    const result = {
      has_more: false,
      note: "Returned 0 queries.",
      page: 9999,
      page_size: 1000,
      queries: [],
    };
    stubToolResponse(result);

    await expect(
      new McpClient({ token: "test-token" }).callTool("list_site_queries", {
        property,
        page: 9999,
        page_size: 1000,
      }),
    ).resolves.toEqual(result);
  });

  test("list_site_pages failure zeroes every field but the note", async () => {
    stubToolResponse({ has_more: false, hosts: null, note: failureNote, page: 0, page_size: 0 });

    await expect(
      new McpClient({ token: "test-token" }).callTool("list_site_pages", {
        property,
        page: 1,
        page_size: 2,
      }),
    ).rejects.toThrow(failureNote);
  });

  test("list_content_changes failure echoes an empty property and is still a failure", async () => {
    stubToolResponse({ days: null, end_date: "", note: failureNote, property: "", start_date: "" });

    await expect(
      new McpClient({ token: "test-token" }).callTool("list_content_changes", { property }),
    ).rejects.toThrow(failureNote);
  });

  test("an unknown portfolio is a failure", async () => {
    const note = 'Portfolio "nope" was not found. Available portfolios: Alpha, Beta.';
    stubToolResponse({ note });

    await expect(
      new McpClient({ token: "test-token" }).callTool("get_portfolio_performance", {
        portfolio: "nope",
        start_date: "2026-09-01",
        end_date: "2026-09-30",
      }),
    ).rejects.toThrow(note);
  });

  test("list_sites with a note remains successful when the request has no property", async () => {
    const result = {
      note: "Use one of these sites when using other SEO Gets Tools",
      sites: [property],
    };
    stubToolResponse(result);

    await expect(
      new McpClient({ token: "test-token" }).callTool("list_sites", { filter: "all" }),
    ).resolves.toEqual(result);
  });
});

const EMPTY_PERFORMANCE = { data: "" };

describe("new read commands send the right tool and arguments", () => {
  test("perf sends dimensions, metrics, filters and branded flag", async () => {
    const [tool, args] = await captureToolCall([
      "perf",
      "sc-domain:example.com",
      "2026-09-01",
      "2026-09-30",
      "date,sessionSourceMedium",
      "--metrics",
      "sessions,keyEvents",
      "--branded-queries",
      "false",
      "--filters",
      '[{"dimension":"page","operator":"contains","expression":"/blog/"}]',
    ], EMPTY_PERFORMANCE);
    expect(tool).toBe("get_site_performance");
    expect(args).toEqual({
      property: "sc-domain:example.com",
      start_date: "2026-09-01",
      end_date: "2026-09-30",
      dimensions: ["date", "sessionSourceMedium"],
      metrics: ["sessions", "keyEvents"],
      branded_queries: false,
      filters: [{ dimension: "page", operator: "contains", expression: "/blog/" }],
    });
  });

  test("perf without --metrics lets the server return every metric", async () => {
    const [, args] = await captureToolCall([
      "perf",
      "sc-domain:example.com",
      "2026-09-01",
      "2026-09-30",
    ], EMPTY_PERFORMANCE);
    expect(args).not.toHaveProperty("metrics");
    expect(args).not.toHaveProperty("dimensions");
  });

  test("portfolio perf sends the portfolio, not a property", async () => {
    const [tool, args] = await captureToolCall([
      "portfolio",
      "perf",
      "Roofing Sites",
      "2026-09-01",
      "2026-09-30",
      "site",
    ], EMPTY_PERFORMANCE);
    expect(tool).toBe("get_portfolio_performance");
    expect(args).toEqual({
      portfolio: "Roofing Sites",
      start_date: "2026-09-01",
      end_date: "2026-09-30",
      dimensions: ["site"],
    });
  });

  test("portfolio list calls list_portfolios with no arguments", async () => {
    const [tool, args] = await captureToolCall(["portfolio", "list"]);
    expect(tool).toBe("list_portfolios");
    expect(args).toEqual({});
  });

  test("changes maps every flag to its wire field", async () => {
    const [tool, args] = await captureToolCall([
      "changes",
      "sc-domain:example.com",
      "--from",
      "2026-09-01",
      "--to",
      "2026-09-30",
      "--types",
      "annotations,google_updates",
      "--page-contains",
      "/blog/",
      "--group",
      "Blog",
      "--priority-only",
      "--diff",
    ]);
    expect(tool).toBe("list_content_changes");
    expect(args).toEqual({
      property: "sc-domain:example.com",
      start_date: "2026-09-01",
      end_date: "2026-09-30",
      event_types: ["annotations", "google_updates"],
      page_contains: "/blog/",
      content_group: "Blog",
      priority_only: true,
      include_text_diff: true,
    });
  });

  test("changes with no flags sends only the property", async () => {
    const [, args] = await captureToolCall(["changes", "sc-domain:example.com"]);
    expect(args).toEqual({ property: "sc-domain:example.com" });
  });

  test("pages and queries send the required page and page_size", async () => {
    const [pagesTool, pagesArgs] = await captureToolCall(["pages", "sc-domain:example.com"]);
    expect(pagesTool).toBe("list_site_pages");
    expect(pagesArgs).toEqual({ property: "sc-domain:example.com", page: 1, page_size: 1000 });

    const [queriesTool, queriesArgs] = await captureToolCall([
      "queries",
      "sc-domain:example.com",
      "--page",
      "3",
      "--page-size",
      "50",
    ]);
    expect(queriesTool).toBe("list_site_queries");
    expect(queriesArgs).toEqual({ property: "sc-domain:example.com", page: 3, page_size: 50 });
  });

  test("groups and clusters call their list tools", async () => {
    const [groupsTool] = await captureToolCall(["groups", "sc-domain:example.com"]);
    expect(groupsTool).toBe("list_content_groups");
    const [clustersTool] = await captureToolCall(["clusters", "sc-domain:example.com"]);
    expect(clustersTool).toBe("list_topic_clusters");
  });

  test("pages --all walks pages until has_more is false", async () => {
    const fakePage = async (_tool: string, args: Record<string, unknown> = {}) => ({
      has_more: args.page === 1,
      hosts: [{ host: "https://example.com", paths: [`/p${String(args.page)}`] }],
      page: args.page,
      page_size: args.page_size,
    });
    const callTool = spyOn(McpClient.prototype, "callTool").mockImplementation(
      fakePage as typeof McpClient.prototype.callTool,
    );
    const write = spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await buildProgram().parseAsync(
        ["--token", "t", "pages", "sc-domain:example.com", "--all", "--format", "json"],
        { from: "user" },
      );
      expect(callTool).toHaveBeenCalledTimes(2);
      const out = JSON.parse(String(write.mock.calls[0]?.[0]));
      expect(out.map((row: { url: string }) => row.url)).toEqual([
        "https://example.com/p1",
        "https://example.com/p2",
      ]);
    } finally {
      callTool.mockRestore();
      write.mockRestore();
    }
  });
});
