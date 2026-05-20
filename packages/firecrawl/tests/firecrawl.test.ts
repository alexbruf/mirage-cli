import { describe, expect, test } from "bun:test";
import { runCommander } from "@mirage-cli/core";
import { buildProgram, firecrawlCommand } from "../src/index.ts";

const dec = new TextDecoder();

describe("@mirage-cli/firecrawl", () => {
  test("buildProgram() captures the firecrawl Command", async () => {
    const program = await buildProgram();
    expect(program.name()).toBe("firecrawl");
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
    expect(program.commands.length).toBeGreaterThan(0);
    expect(program.commands.map((c: { name: () => string }) => c.name())).toContain("scrape");
  });

  test("buildProgram() is idempotent (same instance on repeat)", async () => {
    const a = await buildProgram();
    const b = await buildProgram();
    expect(a).toBe(b);
  });

  test("runCommander(program, ['--version']) → exitCode 0 + version on stdout", async () => {
    const program = await buildProgram();
    const r = await runCommander(program, ["--version"]);
    expect(r.exitCode).toBe(0);
    expect(dec.decode(r.stdout).trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("runCommander(program, ['--help']) → exitCode 0 + usage on stdout", async () => {
    const program = await buildProgram();
    const r = await runCommander(program, ["--help"]);
    expect(r.exitCode).toBe(0);
    expect(dec.decode(r.stdout)).toContain("Usage: firecrawl");
  });

  test("runCommander(program, ['scrape', '--help']) → subcommand help", async () => {
    const program = await buildProgram();
    const r = await runCommander(program, ["scrape", "--help"]);
    expect(r.exitCode).toBe(0);
    expect(dec.decode(r.stdout)).toContain("scrape");
  });

  test("runCommander(program, ['nope']) → non-zero exit + error on stderr", async () => {
    const program = await buildProgram();
    const r = await runCommander(program, ["nope"]);
    expect(r.exitCode).not.toBe(0);
    expect(dec.decode(r.stderr)).toContain("unknown command");
  });

  test("firecrawlCommand (MirageCommandFn) routes argv via texts and produces stdout stream", async () => {
    const [stdout, ioresult] = await firecrawlCommand(
      null,
      [],
      ["--version"],
      { stdin: null, flags: {} },
    );
    expect(stdout).not.toBeNull();
    const bytes = await new Response(stdout as ReadableStream).arrayBuffer();
    expect(dec.decode(new Uint8Array(bytes)).trim()).toMatch(/^\d+\.\d+\.\d+/);
    // exitCode is mirrored in via stream.done.then; await tick so it lands.
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(ioresult.exitCode).toBe(0);
  });
});
