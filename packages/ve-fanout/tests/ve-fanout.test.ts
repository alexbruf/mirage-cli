import { describe, expect, test } from "bun:test";
import { buildProgram } from "../src/index.ts";

describe("@mirage-cli/ve-fanout", () => {
  test("re-exports a cached buildProgram (no side effects) with the ve-fanout commands", () => {
    const a = buildProgram();
    const b = buildProgram();
    expect(a).toBe(b); // cached
    expect(a.name()).toBe("ve-fanout");
    const names = a.commands.map((c) => c.name());
    expect(names).toContain("queries");
    expect(names).toContain("credits");
    expect(names).toContain("status");
  });
});
