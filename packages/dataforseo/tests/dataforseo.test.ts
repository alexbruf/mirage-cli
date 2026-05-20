import { describe, expect, test } from "bun:test";
import { runCommander } from "@mirage-cli/core";
import { buildProgram, dataforseoCommand } from "../src/index.ts";

const dec = new TextDecoder();

describe("@mirage-cli/dataforseo", () => {
  test("buildProgram() returns a Commander program with subcommands", () => {
    const program = buildProgram();
    expect(program.name()).toBe("dfs");
    expect(program.commands.length).toBeGreaterThan(5);
    const names = program.commands.map((c: { name: () => string }) => c.name());
    expect(names).toContain("login");
    expect(names).toContain("raw");
    expect(names).toContain("keywords");
  });

  test("buildProgram() is idempotent", () => {
    expect(buildProgram()).toBe(buildProgram());
  });

  test("runCommander(program, ['--version']) → exitCode 0 + version on stdout", async () => {
    const r = await runCommander(buildProgram(), ["--version"]);
    expect(r.exitCode).toBe(0);
    expect(dec.decode(r.stdout).trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("runCommander(program, ['--help']) → exitCode 0 + usage on stdout", async () => {
    const r = await runCommander(buildProgram(), ["--help"]);
    expect(r.exitCode).toBe(0);
    expect(dec.decode(r.stdout)).toContain("dfs");
    expect(dec.decode(r.stdout)).toContain("keywords");
  });

  test("runCommander(program, ['keywords', '--help']) → subcommand help", async () => {
    const r = await runCommander(buildProgram(), ["keywords", "--help"]);
    expect(r.exitCode).toBe(0);
    expect(dec.decode(r.stdout)).toContain("keywords");
  });

  test("dataforseoCommand (MirageCommandFn) routes argv via texts", async () => {
    const [stdout, ioresult] = await dataforseoCommand(
      null,
      [],
      ["--version"],
      { stdin: null, flags: {} },
    );
    expect(stdout).not.toBeNull();
    const bytes = await new Response(stdout as ReadableStream).arrayBuffer();
    expect(dec.decode(new Uint8Array(bytes)).trim()).toMatch(/^\d+\.\d+\.\d+/);
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(ioresult.exitCode).toBe(0);
  });
});
