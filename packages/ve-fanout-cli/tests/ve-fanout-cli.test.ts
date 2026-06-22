import { describe, expect, test } from "bun:test";
import { buildProgram } from "../src/cli.ts";

describe("ve-fanout buildProgram", () => {
  test("registers the expected top-level commands with no import side effects", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name()).sort();
    for (const n of ["credits", "engines", "login", "logout", "orgs", "queries", "status", "whoami"]) {
      expect(names).toContain(n);
    }
  });

  test("is a pure factory — each call returns a fresh, independent program", () => {
    const a = buildProgram();
    const b = buildProgram();
    expect(a).not.toBe(b);
    expect(a.name()).toBe("ve-fanout");
  });

  test("queries exposes the billable/destructive subcommands and create requires --query", () => {
    const queries = buildProgram().commands.find((c) => c.name() === "queries");
    expect(queries).toBeDefined();
    const subs = queries!.commands.map((c) => c.name()).sort();
    expect(subs).toEqual(
      ["create", "delete", "get", "list", "regenerate", "run-engine", "watch"].sort(),
    );
    const create = queries!.commands.find((c) => c.name() === "create");
    expect(create!.options.some((o) => o.long === "--query")).toBe(true);
  });

  test("credits has a default `balance` subcommand", () => {
    const credits = buildProgram().commands.find((c) => c.name() === "credits");
    const balance = credits!.commands.find((c) => c.name() === "balance");
    expect(balance).toBeDefined();
  });
});
