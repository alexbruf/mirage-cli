import { afterEach, describe, expect, test } from "bun:test";
import { runCommander } from "@mirage-cli/core";
import { buildProgram } from "../src/cli.ts";

const decoder = new TextDecoder();
const originalFetch = globalThis.fetch;
const BASE = ["--api-key", "lk_test", "--base-url", "https://looker.test"];

interface Seen {
  method: string;
  url: string;
  auth: string | null;
  body: unknown;
}

function stub(respond: (seen: Seen) => Response): Seen[] {
  const calls: Seen[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const text = await request.text();
    const seen = {
      method: request.method,
      url: request.url,
      auth: request.headers.get("authorization"),
      body: text ? JSON.parse(text) : undefined,
    };
    calls.push(seen);
    return respond(seen);
  }) as typeof fetch;
  return calls;
}

const ok = (data: unknown, status = 200) => Response.json({ ok: true, data }, { status });
const toolText = (value: unknown, isError = false) =>
  Response.json({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }], ...(isError ? { isError: true } : {}) },
  });

async function looker(...argv: string[]) {
  const result = await runCommander(buildProgram(), [...BASE, ...argv]);
  const stdout = decoder.decode(result.stdout);
  return { ...result, out: stdout ? JSON.parse(stdout) : null, err: decoder.decode(result.stderr) };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("program shape", () => {
  test("exposes the documented command groups", () => {
    expect(buildProgram().commands.map((c) => c.name())).toEqual([
      "find", "locations", "snapshot", "changes", "wait",
      "projects", "keywords", "intake",
      "audits", "backlinks", "brand-visibility", "keyword-research", "domain-overview", "prompts",
      "competitor-gap", "gsc",
    ]);
  });
});

describe("REST", () => {
  test("unwraps the {ok,data} envelope and sends the bearer key", async () => {
    const calls = stub(() => ok([{ id: "prj_1", name: "Sunfish" }]));
    const result = await looker("projects", "list", "--archived");
    expect(result.exitCode).toBe(0);
    expect(result.out).toEqual([{ id: "prj_1", name: "Sunfish" }]);
    expect(calls[0]).toMatchObject({ method: "GET", url: "https://looker.test/api/v1/projects?archived=1", auth: "Bearer lk_test" });
    expect(result.costs).toEqual([]);
  });

  test("keywords add sends plain terms when no per-item field is set", async () => {
    const calls = stub(() => ok([], 201));
    await looker("keywords", "add", "prj_1", "best shoes", "trail shoes", "--domain", "example.com");
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://looker.test/api/v1/projects/prj_1/keywords",
      body: { keywords: ["best shoes", "trail shoes"], domain: "example.com" },
    });
  });

  test("keywords add switches to items when a per-item field is set", async () => {
    const calls = stub(() => ok([], 201));
    await looker("keywords", "add", "prj_1", "best shoes", "--device", "mobile", "--location-code", "2826");
    expect(calls[0]!.body).toEqual({
      items: [{ keyword: "best shoes", device: "mobile", locationCode: 2826 }],
    });
  });

  test("history passes days as a query param", async () => {
    const calls = stub(() => ok({ keyword: "x", series: [] }));
    await looker("keywords", "history", "kw_1", "--days", "90");
    expect(calls[0]!.url).toBe("https://looker.test/api/v1/keywords/kw_1/history?days=90");
  });

  test("paid runs report the response costMicros as dollars", async () => {
    stub(() => ok({ id: "krr_1", report: { costMicros: 36000 } }, 201));
    const result = await looker("keyword-research", "run", "running shoes", "--location-code", "2840");
    expect(result.exitCode).toBe(0);
    expect(result.costs).toEqual([{ provider: "looker", usd: 0.036 }]);
  });

  test("paid runs without a stated price still report a call", async () => {
    stub(() => ok({ id: "kw_1", rank: 6 }));
    const result = await looker("keywords", "scan", "kw_1");
    expect(result.costs).toEqual([{ provider: "looker", usd: null }]);
  });

  test("share takes on|off", async () => {
    const calls = stub(() => ok({ shareEnabled: true }));
    await looker("domain-overview", "share", "dov_1", "on");
    expect(calls[0]).toMatchObject({ url: "https://looker.test/api/v1/domain-overview/dov_1/share", body: { enabled: true } });
    const bad = await looker("domain-overview", "share", "dov_1", "yes");
    expect(bad.exitCode).toBe(1);
  });

  test("HTTP errors surface code and hint as JSON on stderr", async () => {
    stub(() => Response.json({ ok: false, error: "Forbidden", code: "forbidden" }, { status: 403 }));
    const result = await looker("projects", "archive", "prj_1");
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.err)).toMatchObject({ status: 403, kind: "forbidden", code: "forbidden" });
  });

  test("missing key fails before any request", async () => {
    const calls = stub(() => ok([]));
    const prior = process.env.LOOKER_API_KEY;
    delete process.env.LOOKER_API_KEY;
    const result = await runCommander(buildProgram(), ["projects", "list"]);
    if (prior !== undefined) process.env.LOOKER_API_KEY = prior;
    expect(result.exitCode).toBe(1);
    expect(calls).toHaveLength(0);
  });
});

describe("MCP", () => {
  test("tools/call posts JSON-RPC and parses the text result", async () => {
    const calls = stub(() => toolText({ projects: [{ id: "prj_1" }] }));
    const result = await looker("find", "sunf", "--type", "project", "--limit", "5");
    expect(result.out).toEqual({ projects: [{ id: "prj_1" }] });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://looker.test/api/mcp",
      body: { jsonrpc: "2.0", method: "tools/call", params: { name: "find", arguments: { query: "sunf", types: ["project"], limit: 5 } } },
    });
  });

  test("isError results exit 1 with the tool message", async () => {
    stub(() => toolText("Error: Project not found", true));
    const result = await looker("snapshot", "--project", "prj_x");
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.err)).toMatchObject({ error: "Project not found", kind: "tool_error" });
  });

  test("SSE replies are read from the last data event", async () => {
    stub(() => new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "{\"connected\":true}" }] } })}\n\n`, {
      headers: { "content-type": "text/event-stream" },
    }));
    const result = await looker("gsc", "status");
    expect(result.out).toEqual({ connected: true });
  });

  test("competitor-gap run is paid and caps competitors at 3", async () => {
    stub(() => toolText({ id: "cg_1" }));
    const result = await looker("competitor-gap", "run", "me.com", "a.com", "b.com");
    expect(result.costs).toEqual([{ provider: "looker", usd: null }]);
    const tooMany = await looker("competitor-gap", "run", "me.com", "a.com", "b.com", "c.com", "d.com");
    expect(tooMany.exitCode).toBe(1);
  });

  test("gsc performance parses dim:op:expr filters", async () => {
    const calls = stub(() => toolText({ rows: [] }));
    await looker("gsc", "performance", "prj_1", "--dimension", "query", "--dimension", "page", "--filter", "query:contains:pricing");
    expect((calls[0]!.body as { params: { arguments: unknown } }).params.arguments).toEqual({
      projectId: "prj_1",
      dimensions: ["query", "page"],
      filters: [{ dimension: "query", operator: "contains", expression: "pricing" }],
    });
  });
});
