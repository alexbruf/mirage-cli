import { describe, expect, test } from "bun:test";
import { buildProgram } from "../src/cli.ts";

describe("@mirage-cli/radar-cli", () => {
  test("buildProgram() returns a configured Commander program", () => {
    const program = buildProgram();
    expect(program.name()).toBe("radar");
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
    const names = program.commands.map((c: { name: () => string }) => c.name());
    expect(names).toContain("login");
    expect(names).toContain("logout");
    expect(names).toContain("jobs");
    expect(names).toContain("analytics");
    expect(names).toContain("models");
  });

  test("jobs subcommands are registered", () => {
    const program = buildProgram();
    const jobs = program.commands.find((c: { name: () => string }) => c.name() === "jobs");
    expect(jobs).toBeDefined();
    const subnames = (jobs as { commands: readonly { name: () => string }[] }).commands.map(
      (c) => c.name(),
    );
    expect(subnames).toContain("list");
    expect(subnames).toContain("create");
    expect(subnames).toContain("download");
    expect(subnames).toContain("retry");
  });
});
