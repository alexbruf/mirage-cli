import { describe, expect, test } from "bun:test";
import { runCommander } from "@mirage-cli/core";
import { buildProgram, timingCommand } from "../src/index.ts";

const dec = new TextDecoder();

describe("@mirage-cli/timing", () => {
  test("buildProgram() returns the timing Command", () => {
    const program = buildProgram();
    expect(program.name()).toBe("timing");
    expect(program.commands.length).toBeGreaterThan(0);
  });

  test("buildProgram() is idempotent", () => {
    expect(buildProgram()).toBe(buildProgram());
  });

  test("runCommander(program, ['--help']) → exitCode 0", async () => {
    const r = await runCommander(buildProgram(), ["--help"]);
    expect(r.exitCode).toBe(0);
    expect(dec.decode(r.stdout)).toContain("Usage: timing");
  });

  test("timingCommand routes argv via texts", async () => {
    const [stdout, ioresult] = await timingCommand(null, [], ["--version"], {
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
