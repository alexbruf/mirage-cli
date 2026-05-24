import { describe, expect, test } from "bun:test";
import { runCommander } from "@mirage-cli/core";
import { buildProgram, callCommand } from "../src/index.ts";

const dec = new TextDecoder();

describe("@mirage-cli/call", () => {
  test("buildProgram() returns the call Command", () => {
    const program = buildProgram();
    expect(program.name()).toBe("call");
    expect(program.commands.length).toBeGreaterThan(0);
  });

  test("buildProgram() is idempotent", () => {
    expect(buildProgram()).toBe(buildProgram());
  });

  test("runCommander(program, ['--help']) → exitCode 0", async () => {
    const r = await runCommander(buildProgram(), ["--help"]);
    expect(r.exitCode).toBe(0);
    expect(dec.decode(r.stdout)).toContain("Usage: call");
  });

  test("callCommand routes argv via texts", async () => {
    const [stdout, ioresult] = await callCommand(null, [], ["--version"], {
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
