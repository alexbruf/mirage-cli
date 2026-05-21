import { describe, expect, test } from "bun:test";
import { runCommander } from "@mirage-cli/core";
import { buildProgram, seogetsCommand } from "../src/index.ts";

const dec = new TextDecoder();

describe("@mirage-cli/seogets", () => {
  test("buildProgram() returns the seogets Command", () => {
    const program = buildProgram();
    expect(program.name()).toBe("seogets");
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
    expect(program.commands.length).toBeGreaterThan(0);
  });

  test("buildProgram() is idempotent (same instance on repeat)", () => {
    const a = buildProgram();
    const b = buildProgram();
    expect(a).toBe(b);
  });

  test("runCommander(program, ['--help']) → exitCode 0 + usage on stdout", async () => {
    const r = await runCommander(buildProgram(), ["--help"]);
    expect(r.exitCode).toBe(0);
    expect(dec.decode(r.stdout)).toContain("Usage: seogets");
  });

  test("seogetsCommand (MirageCommandFn) routes argv via texts and produces stdout stream", async () => {
    const [stdout, ioresult] = await seogetsCommand(null, [], ["--version"], {
      stdin: null,
      flags: {},
    });
    expect(stdout).not.toBeNull();
    const bytes = await new Response(stdout as ReadableStream).arrayBuffer();
    expect(dec.decode(new Uint8Array(bytes)).trim()).toMatch(/^\d+\.\d+\.\d+/);
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(ioresult.exitCode).toBe(0);
  });
});
