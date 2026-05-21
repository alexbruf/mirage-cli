import { describe, expect, test } from "bun:test";
import { buildProgram } from "../src/cli.ts";

describe("@mirage-cli/clarity-cli", () => {
  test("buildProgram() returns a configured Commander program", () => {
    const program = buildProgram();
    expect(program.name()).toBe("clarity");
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
    expect(program.commands.length).toBeGreaterThan(0);
    const names = program.commands.map((c: { name: () => string }) => c.name());
    expect(names).toContain("auth");
    expect(names).toContain("ask");
    expect(names).toContain("sessions");
    expect(names).toContain("ai-traffic");
    expect(names).toContain("ai-sessions");
    expect(names).toContain("docs");
    expect(names).toContain("insights");
    expect(names).toContain("top-pages");
    expect(names).toContain("web-vitals");
    expect(names).toContain("errors");
  });

  test("buildProgram() is independent across calls (no shared state)", () => {
    const a = buildProgram();
    const b = buildProgram();
    expect(a).not.toBe(b);
    expect(a.name()).toBe(b.name());
  });
});
