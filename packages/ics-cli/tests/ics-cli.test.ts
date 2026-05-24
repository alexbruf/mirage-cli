import { describe, expect, test } from "bun:test";
import { buildProgram } from "../src/cli.ts";

describe("@mirage-cli/ics-cli", () => {
  test("buildProgram() returns a configured Commander program", () => {
    const program = buildProgram();
    expect(program.name()).toBe("ics-cli");
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
    const names = program.commands.map((c: { name: () => string }) => c.name());
    expect(names).toContain("today");
    expect(names).toContain("week");
    expect(names).toContain("next");
    expect(names).toContain("events");
    expect(names).toContain("add");
    expect(names).toContain("remove");
    expect(names).toContain("list");
  });

  test("buildProgram() is independent across calls", () => {
    const a = buildProgram();
    const b = buildProgram();
    expect(a).not.toBe(b);
  });
});
