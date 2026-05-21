import { describe, expect, test } from "bun:test";
import { buildProgram } from "../src/cli.ts";

describe("@mirage-cli/presscart-cli", () => {
  test("buildProgram() returns a configured Commander program", () => {
    const program = buildProgram();
    expect(program.name()).toBe("presscart");
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
    const names = program.commands.map((c: { name: () => string }) => c.name());
    expect(names).toContain("login");
    expect(names).toContain("whoami");
    expect(names).toContain("campaigns");
    expect(names).toContain("orders");
    expect(names).toContain("outlets");
    expect(names).toContain("profiles");
    expect(names).toContain("products");
  });

  test("campaigns subcommands are registered", () => {
    const program = buildProgram();
    const camp = program.commands.find(
      (c: { name: () => string }) => c.name() === "campaigns",
    );
    expect(camp).toBeDefined();
    const subnames = (camp as { commands: readonly { name: () => string }[] }).commands.map((c) =>
      c.name(),
    );
    expect(subnames).toContain("list");
    expect(subnames).toContain("create");
    expect(subnames).toContain("assign-items");
    expect(subnames).toContain("status-count");
  });

  test("orders has checkout subcommand", () => {
    const program = buildProgram();
    const ord = program.commands.find((c: { name: () => string }) => c.name() === "orders");
    const sub = (ord as { commands: readonly { name: () => string }[] }).commands.map((c) => c.name());
    expect(sub).toContain("checkout");
    expect(sub).toContain("items");
  });
});
