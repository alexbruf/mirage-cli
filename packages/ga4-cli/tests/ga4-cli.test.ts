import { describe, expect, test } from "bun:test";
import { buildProgram } from "../src/cli.ts";

describe("@mirage-cli/ga4-cli", () => {
  test("buildProgram() returns a configured Commander program", () => {
    const program = buildProgram();
    expect(program.name()).toBe("ga4");
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
    expect(program.commands.length).toBeGreaterThan(0);
    const names = program.commands.map((c: { name: () => string }) => c.name());
    // Reporting commands
    expect(names).toContain("report");
    expect(names).toContain("realtime");
    expect(names).toContain("batch-report");
    // Admin commands
    expect(names).toContain("accounts");
    expect(names).toContain("properties");
    // Profiles + OAuth additions
    expect(names).toContain("profiles");
    expect(names).toContain("login");
    expect(names).toContain("logout");
    expect(names).toContain("whoami");
  });

  test("buildProgram() is independent across calls (no shared state)", () => {
    const a = buildProgram();
    const b = buildProgram();
    expect(a).not.toBe(b);
    expect(a.name()).toBe(b.name());
  });
});
