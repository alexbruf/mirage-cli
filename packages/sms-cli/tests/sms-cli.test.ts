import { describe, expect, test } from "bun:test";
import { buildProgram } from "../src/cli.ts";

describe("@mirage-cli/sms-cli", () => {
  test("buildProgram() returns a configured Commander program", () => {
    const program = buildProgram();
    expect(program.name()).toBe("sms");
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
    const names = program.commands.map((c: { name: () => string }) => c.name());
    expect(names).toContain("list");
    expect(names).toContain("send");
    expect(names).toContain("reply");
    expect(names).toContain("read");
    expect(names).toContain("search");
    expect(names).toContain("config");
  });

  test("buildProgram() is cached (same instance on repeat — singleton subcommands)", () => {
    expect(buildProgram()).toBe(buildProgram());
  });
});
