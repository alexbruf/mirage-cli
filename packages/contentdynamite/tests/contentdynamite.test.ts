import { describe, expect, test } from "bun:test";
import { runCommander } from "@mirage-cli/core";
import {
  buildProgram,
  contentdynamiteCommand,
  contentdynamiteResource,
} from "../src/index.ts";

const decoder = new TextDecoder();

describe("@mirage-cli/contentdynamite", () => {
  test("buildProgram returns a cached configured Commander program", () => {
    const first = buildProgram();
    const second = buildProgram();
    expect(first).toBe(second);
    expect(first.name()).toBe("ve-dynamite");
    expect(first.commands.map((command) => command.name())).toEqual([
      "whoami",
      "tokens",
      "profiles",
      "icp",
      "categories",
      "articles",
      "batches",
      "landing-pages",
      "images",
      "upload",
    ]);
  });

  test("runCommander renders help", async () => {
    const result = await runCommander(buildProgram(), ["--help"]);
    expect(result.exitCode).toBe(0);
    expect(decoder.decode(result.stdout)).toContain("Usage: ve-dynamite");
  });

  test("Mirage command routes argv through text operands", async () => {
    const [stdout, ioResult] = await contentdynamiteCommand(null, [], ["--version"], {
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
    const resource = await contentdynamiteResource();
    expect(resource.kind).toBe("contentdynamite");
    expect(resource.prompt).toContain("spend real money");
    expect(resource.commands?.()).toHaveLength(1);
    expect(resource.commands?.()[0]?.name).toBe("ve-dynamite");
  });
});
