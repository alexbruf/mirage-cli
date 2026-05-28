import { describe, expect, test } from "bun:test";
import { buildProgram } from "../src/cli.ts";

function subnames(program: ReturnType<typeof buildProgram>, name: string): string[] {
  const cmd = program.commands.find((c: { name: () => string }) => c.name() === name);
  return (cmd as { commands: readonly { name: () => string }[] }).commands.map((c) => c.name());
}

describe("@mirage-cli/radar-cli", () => {
  test("buildProgram() returns a configured Commander program named radar", () => {
    const program = buildProgram();
    expect(program.name()).toBe("radar");
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
    const names = program.commands.map((c: { name: () => string }) => c.name());
    // AI-visibility V1 surface
    expect(names).toContain("projects");
    expect(names).toContain("queries");
    expect(names).toContain("game-plans");
    expect(names).toContain("results");
    expect(names).toContain("jobs");
    expect(names).toContain("credits");
    expect(names).toContain("export");
    expect(names).toContain("orgs");
    // auth
    expect(names).toContain("login");
    expect(names).toContain("whoami");
    expect(names).toContain("logout");
    // the old batch-jobs surface must be gone
    expect(names).not.toContain("models");
    expect(names).not.toContain("analytics");
  });

  test("game-plans exposes read + write subcommands", () => {
    const program = buildProgram();
    const subs = subnames(program, "game-plans");
    expect(subs).toContain("list");
    expect(subs).toContain("get");
    expect(subs).toContain("update");
    expect(subs).toContain("complete-action");
  });

  test("orgs exposes multi-tenant subcommands", () => {
    const program = buildProgram();
    const subs = subnames(program, "orgs");
    expect(subs).toContain("list");
    expect(subs).toContain("use");
    expect(subs).toContain("current");
    expect(subs).toContain("clear");
  });

  test("program-level org/url/api-key flags are declared", () => {
    const program = buildProgram();
    const optionFlags = program.options.map((o: { long?: string }) => o.long);
    expect(optionFlags).toContain("--org");
    expect(optionFlags).toContain("--url");
    expect(optionFlags).toContain("--api-key");
  });
});
