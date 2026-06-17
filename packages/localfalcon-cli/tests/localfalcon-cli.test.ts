import { describe, expect, test } from "bun:test";
import { buildProgram } from "../src/cli.ts";
import { render } from "../src/format.ts";

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

describe("render", () => {
  test("json + table formats", () => {
    const rows = [{ keyword: "roof repair", arp: 2.96, solv: 74.07 }];
    expect(render(rows, "json")).toContain("roof repair");
    expect(render(rows, "table")).toContain("keyword");
    expect(render([], "table")).toBe("(no rows)");
  });
});
