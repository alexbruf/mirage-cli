import { describe, expect, test } from "bun:test";
import { buildProgram } from "../src/index.ts";

describe("@mirage-cli/localfalcon", () => {
  test("re-exports a working buildProgram (cached, no side effects)", () => {
    const a = buildProgram();
    const b = buildProgram();
    expect(a).toBe(b); // cached
    expect(a.name()).toBe("localfalcon");
    const names = a.commands.map((c) => c.name()).sort();
    expect(names).toContain("report");
    expect(names).toContain("scan");
  });
});
