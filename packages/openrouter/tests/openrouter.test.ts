import { describe, expect, test } from "bun:test";
import { runCommander } from "@mirage-cli/core";
import { buildProgram, openrouterCommand } from "../src/index.ts";

const decoder = new TextDecoder();

describe("@mirage-cli/openrouter", () => {
  test("re-exports one cached Commander program", () => {
    const first = buildProgram();
    const second = buildProgram();
    expect(first).toBe(second);
    expect(first.name()).toBe("openrouter");
    expect(first.commands.map((command) => command.name())).toContain("chat");
    expect(first.commands.map((command) => command.name())).toContain("images");
  });

  test("runs help through @mirage-cli/core", async () => {
    const result = await runCommander(buildProgram(), ["--help"]);
    expect(result.exitCode).toBe(0);
    expect(decoder.decode(result.stdout)).toContain("Usage: openrouter");
    expect(decoder.decode(result.stdout)).toContain("images");
  });

  test("routes argv through the ready-made Mirage command", async () => {
    const [stdout, io] = await openrouterCommand(null, [], ["--version"], {
      stdin: null,
      flags: {},
    });
    expect(stdout).not.toBeNull();
    const bytes = await new Response(stdout as ReadableStream).arrayBuffer();
    expect(decoder.decode(new Uint8Array(bytes)).trim()).toBe("0.2.0");
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(io.exitCode).toBe(0);
  });
});
