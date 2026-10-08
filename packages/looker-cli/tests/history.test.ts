import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommander } from "@mirage-cli/core";
import { buildProgram } from "../src/cli.ts";
import { LookerClient } from "../src/client.ts";
import { filterHistory, historyAll, resolveWindow } from "../src/history.ts";

const decoder = new TextDecoder();
const originalFetch = globalThis.fetch;
const NOW = new Date("2026-10-08T12:00:00Z");

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const history = (keyword: string, dates: string[]) => ({
  keyword,
  series: [
    { label: "me.com", isTarget: true, points: dates.map((date, i) => ({ date, rank: i + 1, ts: i })) },
    { label: "rival.com", isTarget: false, points: dates.map((date) => ({ date, rank: 9 })) },
  ],
});

/** Fake looker.so: a project with `n` keywords, each with checks on the given dates. */
function fakeApi(n: number, dates: string[], opts: { limitedOnce?: string } = {}) {
  const calls: string[] = [];
  let limited = false;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    calls.push(url.pathname + url.search);
    if (url.pathname.endsWith("/keywords")) {
      return Response.json({ ok: true, data: Array.from({ length: n }, (_, i) => ({ id: `kw_${i}`, keyword: `k${i}` })) });
    }
    const id = url.pathname.split("/")[4]!;
    if (opts.limitedOnce === id && !limited) {
      limited = true;
      return Response.json({ ok: false, error: "slow down", code: "rate_limited" }, { status: 429, headers: { "retry-after": "2" } });
    }
    return Response.json({ ok: true, data: history(`k${id.slice(3)}`, dates) });
  }) as typeof fetch;
  return calls;
}

function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; }, advance: (ms: number) => { t += ms; } };
}

describe("date window", () => {
  test("--since becomes the smallest --days that covers it", () => {
    expect(resolveWindow({ since: "2026-10-01" }, NOW)).toEqual({ days: 8, since: "2026-10-01" });
    expect(resolveWindow({ since: "2026-10-08", until: "2026-10-08" }, NOW)).toEqual({ days: 1, since: "2026-10-08", until: "2026-10-08" });
    expect(resolveWindow({}, NOW)).toEqual({ days: 30 });
  });

  test("rejects bad dates, reversed windows, --days with --since, and >365 days", () => {
    expect(() => resolveWindow({ since: "10/01/2026" }, NOW)).toThrow(/date like/);
    expect(() => resolveWindow({ since: "2026-10-05", until: "2026-10-01" }, NOW)).toThrow(/on or before/);
    expect(() => resolveWindow({ days: 7, since: "2026-10-01" }, NOW)).toThrow(/not both/);
    expect(() => resolveWindow({ since: "2025-09-01" }, NOW)).toThrow(/2025-10-09 or later/);
  });

  test("filterHistory keeps only checks inside the window", () => {
    const filtered = filterHistory(history("k", ["2026-09-30", "2026-10-01", "2026-10-03", "2026-10-05"]), { days: 9, since: "2026-10-01", until: "2026-10-03" });
    expect(filtered.series[0]!.points.map((p) => p.date)).toEqual(["2026-10-01", "2026-10-03"]);
  });
});

describe("history-all", () => {
  const client = () => new LookerClient({ apiKey: "lk", baseUrl: "https://looker.test" });

  test("one row per check, paced, with competitors unless --target-only", async () => {
    const calls = fakeApi(3, ["2026-10-01", "2026-10-02"]);
    const clock = fakeClock();
    const all = await historyAll(client(), "prj", { days: 8, since: "2026-10-01", offset: 0, maxSeconds: 70, targetOnly: false, now: clock.now, sleep: clock.sleep });
    expect(all).toMatchObject({ keywords_total: 3, processed: 3, next_offset: null, complete: true });
    expect(all.rows).toHaveLength(12);
    expect(all.rows[0]).toEqual({ keywordId: "kw_0", keyword: "k0", series: "me.com", isTarget: true, date: "2026-10-01", rank: 1, ts: 0, notFound: false });
    expect(calls.filter((c) => c.includes("/history"))).toEqual([
      "/api/v1/keywords/kw_0/history?days=8", "/api/v1/keywords/kw_1/history?days=8", "/api/v1/keywords/kw_2/history?days=8",
    ]);
    expect(clock.now()).toBeGreaterThanOrEqual(1100); // 550ms between the three calls

    fakeApi(3, ["2026-10-01"]);
    const target = await historyAll(client(), "prj", { days: 8, offset: 0, maxSeconds: 70, targetOnly: true, now: fakeClock().now, sleep: fakeClock().sleep });
    expect(target.rows.every((r) => r.isTarget === true)).toBe(true);
  });

  test("stops before the time budget and reports next_offset", async () => {
    fakeApi(500, ["2026-10-01"]);
    const clock = fakeClock();
    const first = await historyAll(client(), "prj", { days: 8, offset: 0, maxSeconds: 70, targetOnly: true, now: clock.now, sleep: clock.sleep });
    expect(first.complete).toBe(false);
    expect(first.processed).toBeGreaterThan(100);
    expect(first.processed).toBeLessThan(130);
    expect(first.next_offset).toBe(first.processed);
    const rest = await historyAll(client(), "prj", { days: 8, offset: first.next_offset!, limit: 10, maxSeconds: 70, targetOnly: true, now: fakeClock().now, sleep: fakeClock().sleep });
    expect(rest).toMatchObject({ offset: first.processed, processed: 10, next_offset: first.processed + 10, complete: false });
  });

  test("waits out a 429 once, then carries on", async () => {
    fakeApi(3, ["2026-10-01"], { limitedOnce: "kw_1" });
    const clock = fakeClock();
    const all = await historyAll(client(), "prj", { days: 8, offset: 0, maxSeconds: 70, targetOnly: true, now: clock.now, sleep: clock.sleep });
    expect(all).toMatchObject({ processed: 3, complete: true, failed: [] });
    expect(clock.now()).toBeGreaterThanOrEqual(2000);
  });
});

describe("commands", () => {
  const BASE = ["--api-key", "lk", "--base-url", "https://looker.test"];

  test("keywords history --since filters checks and asks for enough days", async () => {
    const calls = fakeApi(1, ["2026-01-01", "2099-01-01"]);
    const r = await runCommander(buildProgram(), [...BASE, "--format", "ndjson", "keywords", "history", "kw_0", "--until", "2026-06-30"]);
    expect(r.exitCode).toBe(0);
    const lines = decoder.decode(r.stdout).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.date)).toEqual(["2026-01-01", "2026-01-01"]);
    expect(calls[0]).toBe("/api/v1/keywords/kw_0/history?days=30");
  });

  test("history-all --output then --append builds one csv with one header", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "looker-")), "h.csv");
    fakeApi(4, ["2026-10-01"]);
    const first = await runCommander(buildProgram(), [...BASE, "--format", "csv", "--output", path, "keywords", "history-all", "prj", "--limit", "2", "--target-only"]);
    expect(first.exitCode, decoder.decode(first.stderr)).toBe(0);
    expect(JSON.parse(decoder.decode(first.stdout))).toMatchObject({ rows: 2, processed: 2, next_offset: 2, complete: false });
    fakeApi(4, ["2026-10-01"]);
    const second = await runCommander(buildProgram(), [...BASE, "--format", "csv", "--output", path, "--append", "keywords", "history-all", "prj", "--offset", "2", "--target-only"]);
    expect(JSON.parse(decoder.decode(second.stdout))).toMatchObject({ appended: true, rows: 2, next_offset: null, complete: true });
    const csv = readFileSync(path, "utf8").trim().split("\n");
    expect(csv[0]).toBe("keywordId,keyword,series,isTarget,date,rank,ts,notFound");
    expect(csv.slice(1).map((l) => l.split(",")[0])).toEqual(["kw_0", "kw_1", "kw_2", "kw_3"]);
  });

  test("--append without --output, or with json, fails", async () => {
    fakeApi(1, ["2026-10-01"]);
    const a = await runCommander(buildProgram(), [...BASE, "--format", "csv", "--append", "keywords", "history", "kw_0"]);
    expect(a.exitCode).toBe(1);
    expect(decoder.decode(a.stderr)).toContain("--append needs --output");
  });
});
