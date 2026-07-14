import { describe, expect, test } from "bun:test";
import { runCommander } from "@mirage-cli/core";
import {
  buildProgram,
  rapidurlindexerCommand,
  rapidurlindexerResource,
} from "../src/index.ts";

const decoder = new TextDecoder();

describe("@mirage-cli/rapidurlindexer", () => {
  test("buildProgram returns a cached configured Commander program", () => {
    const first = buildProgram();
    const second = buildProgram();
    expect(first).toBe(second);
    expect(first.name()).toBe("rapidurlindexer");
    expect(first.commands.map((command) => command.name())).toEqual(["credits", "projects"]);
  });

  test("runCommander renders help", async () => {
    const result = await runCommander(buildProgram(), ["--help"]);
    expect(result.exitCode).toBe(0);
    expect(decoder.decode(result.stdout)).toContain("Usage: rapidurlindexer");
  });

  test("Mirage command routes argv through text operands", async () => {
    const [stdout, ioResult] = await rapidurlindexerCommand(null, [], ["--version"], {
      stdin: null,
      flags: {},
    });
    expect(stdout).not.toBeNull();
    const bytes = await new Response(stdout as ReadableStream).arrayBuffer();
    expect(decoder.decode(new Uint8Array(bytes)).trim()).toBe("0.1.0");
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(ioResult.exitCode).toBe(0);
  });

  test("resource exposes the billable command boundary", async () => {
    const resource = await rapidurlindexerResource();
    expect(resource.kind).toBe("rapidurlindexer");
    expect(resource.prompt).toContain("spends credits");
    expect(resource.commands?.()).toHaveLength(1);
  });
});
