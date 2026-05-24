import { describe, expect, test } from "bun:test";
import { runCommander } from "@mirage-cli/core";
import { buildProgram, smsCommand } from "../src/index.ts";

const dec = new TextDecoder();

describe("@mirage-cli/sms", () => {
  test("buildProgram() returns the sms Command", () => {
    const program = buildProgram();
    expect(program.name()).toBe("sms");
    expect(program.commands.length).toBeGreaterThan(0);
  });

  test("buildProgram() is idempotent", () => {
    expect(buildProgram()).toBe(buildProgram());
  });

  test("runCommander(program, ['--help']) → exitCode 0", async () => {
    const r = await runCommander(buildProgram(), ["--help"]);
    expect(r.exitCode).toBe(0);
    expect(dec.decode(r.stdout)).toContain("Usage: sms");
  });

  test("smsCommand routes argv via texts", async () => {
    const [stdout, ioresult] = await smsCommand(null, [], ["--version"], {
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
