import { describe, expect, test } from "bun:test";
import { runCommander } from "@mirage-cli/core";
import { buildProgram, icsCommand } from "../src/index.ts";

const dec = new TextDecoder();

describe("@mirage-cli/ics", () => {
  test("buildProgram() returns the ics-cli Command", () => {
    const program = buildProgram();
    expect(program.name()).toBe("ics-cli");
    expect(program.commands.length).toBeGreaterThan(0);
  });

  test("buildProgram() is idempotent", () => {
    expect(buildProgram()).toBe(buildProgram());
  });

  test("runCommander(program, ['--help']) → exitCode 0 + usage on stdout", async () => {
    const r = await runCommander(buildProgram(), ["--help"]);
    expect(r.exitCode).toBe(0);
    expect(dec.decode(r.stdout)).toContain("Usage: ics-cli");
  });

  test("icsCommand routes argv via texts", async () => {
    const [stdout, ioresult] = await icsCommand(null, [], ["--help"], {
      stdin: null,
      flags: {},
    });
    expect(stdout).not.toBeNull();
    const bytes = await new Response(stdout as ReadableStream).arrayBuffer();
    expect(dec.decode(new Uint8Array(bytes))).toContain("Usage: ics-cli");
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(ioresult.exitCode).toBe(0);
  });
});
