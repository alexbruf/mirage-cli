import { describe, expect, test } from "bun:test";
import { buildProgram } from "../src/cli.ts";

describe("@mirage-cli/call-cli", () => {
  test("buildProgram() returns a configured Commander program", () => {
    const program = buildProgram();
    expect(program.name()).toBe("call");
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
    const names = program.commands.map((c: { name: () => string }) => c.name());
    expect(names).toContain("call");
    expect(names).toContain("hangup");
    expect(names).toContain("status");
    expect(names).toContain("upload");
    expect(names).toContain("config");
  });

  test("buildProgram() is cached (same instance on repeat — singleton subcommands)", () => {
    expect(buildProgram()).toBe(buildProgram());
  });
});
