import { describe, expect, test } from "bun:test";
import { buildProgram } from "../src/index.ts";

describe("@mirage-cli/figma", () => {
  test("re-exports a working buildProgram (cached, no side effects)", () => {
    const a = buildProgram();
    const b = buildProgram();
    expect(a).toBe(b);
    expect(a.name()).toBe("figma");
    const names = a.commands.map((c) => c.name()).sort();
    expect(names).toContain("files");
    expect(names).toContain("export");
    expect(names).toContain("comments");
    expect(names).toContain("variables");
    expect(names).toContain("dev-resources");
  });
});
