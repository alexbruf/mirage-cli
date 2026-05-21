import { describe, expect, test } from "bun:test";
import { buildProgram } from "../src/cli.ts";
import { unwrapToolResult } from "../src/mcp.ts";

describe("@mirage-cli/seogets-cli", () => {
  test("buildProgram() returns a configured Commander program", () => {
    const program = buildProgram();
    expect(program.name()).toBe("seogets");
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
    expect(program.commands.length).toBeGreaterThan(0);
    const names = program.commands.map((c: { name: () => string }) => c.name());
    expect(names).toContain("tools");
    expect(names).toContain("sites");
    expect(names).toContain("gsc");
    expect(names).toContain("indexing");
    expect(names).toContain("call");
  });

  test("indexing subcommand has overview + status children", () => {
    const program = buildProgram();
    const indexing = program.commands.find(
      (c: { name: () => string }) => c.name() === "indexing",
    ) as { commands: readonly { name: () => string }[] } | undefined;
    expect(indexing).toBeDefined();
    const children = indexing!.commands.map((c) => c.name());
    expect(children).toContain("overview");
    expect(children).toContain("status");
  });

  test("buildProgram() is independent across calls (no shared state)", () => {
    const a = buildProgram();
    const b = buildProgram();
    expect(a).not.toBe(b);
    expect(a.name()).toBe(b.name());
  });

  test("unwrapToolResult unwraps MCP content envelope", () => {
    expect(unwrapToolResult({ content: [{ type: "text", text: '{"a":1}' }] })).toEqual({ a: 1 });
    expect(unwrapToolResult({ content: [{ type: "text", text: "hello" }] })).toBe("hello");
    expect(unwrapToolResult({ structuredContent: { ok: true } })).toEqual({ ok: true });
    expect(unwrapToolResult({ foo: 42 })).toEqual({ foo: 42 });
  });
});
