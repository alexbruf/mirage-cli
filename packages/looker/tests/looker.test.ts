import { describe, expect, test } from "bun:test";
import { runCommander } from "@mirage-cli/core";
import { buildProgram, lookerCommand, lookerResource } from "../src/index.ts";

const decoder = new TextDecoder();

describe("@mirage-cli/looker", () => {
  test("buildProgram returns a cached configured Commander program", () => {
    const first = buildProgram();
    expect(buildProgram()).toBe(first);
    expect(first.name()).toBe("looker");
  });

  test("runCommander renders help", async () => {
    const result = await runCommander(buildProgram(), ["--help"]);
    expect(result.exitCode).toBe(0);
    expect(decoder.decode(result.stdout)).toContain("Usage: looker");
  });

  test("Mirage command routes argv through text operands", async () => {
    const [stdout, ioResult] = await lookerCommand(null, [], ["--version"], { stdin: null, flags: {} });
    const bytes = await new Response(stdout as ReadableStream).arrayBuffer();
    expect(decoder.decode(new Uint8Array(bytes)).trim()).toBe("0.2.0");
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(ioResult.exitCode).toBe(0);
  });

  test("resource names the paid command boundary", async () => {
    const resource = await lookerResource();
    expect(resource.kind).toBe("looker");
    expect(resource.prompt).toContain("Paid");
    expect(resource.commands?.()).toHaveLength(1);
  });
});
