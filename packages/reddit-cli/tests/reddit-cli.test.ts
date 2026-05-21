import { describe, expect, test } from "bun:test";
import { buildProgram } from "../src/cli.ts";

describe("@mirage-cli/reddit-cli", () => {
  test("buildProgram() returns a configured Commander program", () => {
    const program = buildProgram();
    expect(program.name()).toBe("reddit");
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
    expect(program.commands.length).toBeGreaterThan(0);
    const names = program.commands.map((c: { name: () => string }) => c.name());
    expect(names).toContain("hot");
    expect(names).toContain("search");
    expect(names).toContain("post");
    expect(names).toContain("login");
  });

  test("buildProgram() is independent across calls (no shared state)", () => {
    const a = buildProgram();
    const b = buildProgram();
    expect(a).not.toBe(b);
    expect(a.name()).toBe(b.name());
  });
});
