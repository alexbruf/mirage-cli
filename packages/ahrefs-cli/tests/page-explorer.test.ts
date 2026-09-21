import { afterEach, expect, test } from "bun:test";
import { siteAuditPageExplorerCmd } from "../src/commands/site-audit.ts";
import { invoke } from "../src/framework/runtime.ts";
import { buildProgram } from "../src/cli.ts";
import { runCommander } from "@mirage-cli/core";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("Page Explorer exposes offset in the shared command specification", () => {
  expect(siteAuditPageExplorerCmd.spec.options.some(o => o.long === "offset")).toBe(true);
});

test("Commander help and parsing expose the next-batch option", async () => {
  const help = await runCommander(buildProgram(), ["site-audit", "page-explorer", "--help"]);
  expect(new TextDecoder().decode(help.stdout)).toContain("--offset");
  let requested: URL | undefined;
  globalThis.fetch = (async (input: string | URL | Request) => {
    requested = new URL(String(input));
    return Response.json({ pages: [{ url: "https://example.com/next" }] });
  }) as typeof fetch;
  const result = await runCommander(buildProgram(), [
    "site-audit", "page-explorer", "--project-id", "123", "--offset", "250",
    "--select", "url", "--api-key", "fixture-only", "--json",
  ]);
  expect(result.exitCode).toBe(0);
  expect(requested?.searchParams.get("offset")).toBe("250");
  expect(JSON.parse(new TextDecoder().decode(result.stdout)).pages[0].url).toBe("https://example.com/next");
});

test("subsequent batches retain scope, ordering and all returned rows", async () => {
  const requests: URL[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requests.push(url);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    return Response.json({ pages: Array.from({ length: 250 }, (_, i) => ({
      url: `https://example.com/page-${offset + i}`, http_code: 200,
    })) });
  }) as typeof fetch;
  const all: string[] = [];
  for (const offset of [0, 250]) {
    const result = await invoke(siteAuditPageExplorerCmd, [
      "--project-id", "123", "--date", "2026-09-14T19:48:33Z",
      "--date-compared", "2026-08-14T19:48:33Z", "--issue-id", "example-issue",
      "--where", '{"field":"http_code","is":["eq",200]}',
      "--order-by", "url:asc", "--select", "url,http_code",
      "--limit", "250", "--offset", String(offset),
      "--api-key", "fixture-only", "--json",
    ]);
    expect(result.result.exitCode).toBe(0);
    const rows = JSON.parse(result.text).pages;
    expect(rows.length).toBe(250);
    all.push(...rows.map((r: { url: string }) => r.url));
  }
  expect(requests.length).toBe(2);
  expect(requests.map(u => u.searchParams.get("offset"))).toEqual(["0", "250"]);
  for (const url of requests) {
    expect(url.pathname).toBe("/v3/site-audit/page-explorer");
    expect(url.searchParams.get("project_id")).toBe("123");
    expect(url.searchParams.get("date")).toBe("2026-09-14T19:48:33Z");
    expect(url.searchParams.get("date_compared")).toBe("2026-08-14T19:48:33Z");
    expect(url.searchParams.get("issue_id")).toBe("example-issue");
    expect(url.searchParams.get("order_by")).toBe("url:asc");
    expect(url.searchParams.get("select")).toBe("url,http_code");
    expect(url.searchParams.get("where")).toBe('{"field":"http_code","is":["eq",200]}');
    expect(url.searchParams.get("limit")).toBe("250");
  }
  expect(new Set(all).size).toBe(500);
});
