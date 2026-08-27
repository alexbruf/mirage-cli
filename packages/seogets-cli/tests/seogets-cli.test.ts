import { afterEach, describe, expect, spyOn, test } from "bun:test";
import packageJson from "../package.json" with { type: "json" };
import { buildProgram } from "../src/cli.ts";
import { McpClient, unwrapToolResult } from "../src/mcp.ts";

async function captureToolCall(args: string[]): Promise<[string, Record<string, unknown>]> {
  const callTool = spyOn(McpClient.prototype, "callTool").mockResolvedValue({});
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
    expect(tool).toBe("get_gsc_performance");
    expectPropertyWireKey(args, "sc-domain:example.com");
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
      new McpClient({ token: "test-token" }).callTool("get_gsc_performance", { property }),
    ).resolves.toEqual(result);
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
