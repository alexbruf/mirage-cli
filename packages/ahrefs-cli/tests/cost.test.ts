import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Command } from "commander";
import { runCommander } from "@mirage-cli/core";
import { request } from "../src/client.ts";

/**
 * Ahrefs bills in units and reports the real figure on response headers, which
 * this client used to discard entirely. These tests pin that it is read, that
 * the *actual* header wins over the pre-flight estimate, and that a billed
 * failure is still reported — an unreported charge is the thing this exists to
 * prevent.
 */

const origFetch = globalThis.fetch;
const origKey = process.env.AHREFS_API_KEY;

function stub(headers: Record<string, string>, status = 200, body = "{}") {
  globalThis.fetch = (async () =>
    new Response(body, { status, headers })) as typeof fetch;
}

/** Drive `request()` through a commander program so a cost scope is active. */
function probe(): Command {
  const program = new Command();
  program.name("probe");
  program.command("go").action(async () => {
    try {
      await request({ path: "/site-explorer/overview", query: { target: "x.com" } });
    } catch {
      /* a non-2xx throws; the report must already have been made */
    }
  });
  return program;
}

beforeEach(() => {
  process.env.AHREFS_API_KEY = "test-key";
});
afterEach(() => {
  globalThis.fetch = origFetch;
  if (origKey === undefined) delete process.env.AHREFS_API_KEY;
  else process.env.AHREFS_API_KEY = origKey;
});

describe("ahrefs cost reporting", () => {
  test("reports the units the request actually consumed", async () => {
    stub({ "x-api-units-cost-total-actual": "150", "x-api-units-cost-total": "200" });
    const r = await runCommander(probe(), ["go"]);
    expect(r.costs).toEqual([{ provider: "ahrefs", units: 150, statusCode: 200 }]);
  });

  test("falls back to the estimate when the actual header is absent", async () => {
    stub({ "x-api-units-cost-total": "200" });
    const r = await runCommander(probe(), ["go"]);
    expect(r.costs[0]!.units).toBe(200);
  });

  test("still reports when no units header is present at all", async () => {
    stub({});
    const r = await runCommander(probe(), ["go"]);
    // provider known, amount unknown — different from silence.
    expect(r.costs).toEqual([{ provider: "ahrefs", units: null, statusCode: 200 }]);
  });

  test("reports a cache hit as zero units rather than omitting it", async () => {
    stub({ "x-api-units-cost-total-actual": "0", "x-api-cache": "HIT" });
    const r = await runCommander(probe(), ["go"]);
    expect(r.costs[0]!.units).toBe(0);
  });

  test("reports a billed failure, because a rejected call can still cost", async () => {
    stub({ "x-api-units-cost-total-actual": "50" }, 429, '{"error":"rate limited"}');
    const r = await runCommander(probe(), ["go"]);
    expect(r.costs).toEqual([{ provider: "ahrefs", units: 50, statusCode: 429 }]);
  });

  test("ignores a non-numeric header instead of emitting NaN", async () => {
    stub({ "x-api-units-cost-total-actual": "not-a-number" });
    const r = await runCommander(probe(), ["go"]);
    expect(r.costs[0]!.units).toBeNull();
  });
});
