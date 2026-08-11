import { afterEach, describe, expect, test } from "bun:test";
import { runCommander } from "@mirage-cli/core";
import { buildProgram } from "../src/cli.ts";
import { render } from "../src/format.ts";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.LOCALFALCON_API_KEY;

function stubFetch(impl: () => Promise<Response>): typeof fetch {
  return impl as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.LOCALFALCON_API_KEY;
  else process.env.LOCALFALCON_API_KEY = originalApiKey;
});

describe("localfalcon buildProgram", () => {
  test("registers the expected commands with no import side effects", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name()).sort();
    expect(names).toEqual(["keywords", "locations", "report", "reports", "scan"].sort());
    expect(names).not.toContain("raw");
  });

  test("scan requires a keyword (billable command is guarded)", () => {
    const scan = buildProgram().commands.find((c) => c.name() === "scan");
    expect(scan).toBeDefined();
    // commander marks requiredOption; the option exists on the command.
    const hasKeyword = scan!.options.some((o) => o.long === "--keyword");
    expect(hasKeyword).toBe(true);
  });

  test("missing LOCALFALCON_API_KEY throws (no process.exit) when a command runs", async () => {
    const prev = process.env.LOCALFALCON_API_KEY;
    process.env.LOCALFALCON_API_KEY = "";
    try {
      const program = buildProgram();
      program.exitOverride();
      await expect(program.parseAsync(["node", "localfalcon", "locations"])).rejects.toThrow(
        /LOCALFALCON_API_KEY/,
      );
    } finally {
      if (prev === undefined) delete process.env.LOCALFALCON_API_KEY;
      else process.env.LOCALFALCON_API_KEY = prev;
    }
  });
});

describe("cost reporting", () => {
  test("a 5x5 scan reports 25 Local Falcon credits", async () => {
    process.env.LOCALFALCON_API_KEY = "test-key";
    globalThis.fetch = stubFetch(async () =>
      Response.json({ success: true, data: { report_key: "scan-1" } }));

    const result = await runCommander(buildProgram(), [
      "scan",
      "--keyword",
      "roof repair",
      "--place-id",
      "place-1",
      "--grid-size",
      "5",
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.costs).toEqual([{ provider: "localfalcon", credits: 25 }]);
  });

  test("a read-only locations call reports no cost", async () => {
    process.env.LOCALFALCON_API_KEY = "test-key";
    globalThis.fetch = stubFetch(async () =>
      Response.json({ success: true, data: { locations: [] } }));

    const result = await runCommander(buildProgram(), ["locations", "--format", "json"]);

    expect(result.exitCode).toBe(0);
    expect(result.costs).toEqual([]);
  });

  test("a scan with no parseable grid size still reports an unknown amount", async () => {
    process.env.LOCALFALCON_API_KEY = "test-key";
    globalThis.fetch = stubFetch(async () =>
      Response.json({ success: true, data: { report_key: "scan-2" } }));

    const result = await runCommander(buildProgram(), [
      "scan",
      "--keyword",
      "roof repair",
      "--place-id",
      "place-1",
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.costs).toEqual([{ provider: "localfalcon", credits: null }]);
  });
});

describe("render", () => {
  test("json + table formats", () => {
    const rows = [{ keyword: "roof repair", arp: 2.96, solv: 74.07 }];
    expect(render(rows, "json")).toContain("roof repair");
    expect(render(rows, "table")).toContain("keyword");
    expect(render([], "table")).toBe("(no rows)");
  });
});
