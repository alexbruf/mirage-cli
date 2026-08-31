import { afterEach, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { ApiError, parseSseStream } from "../src/client.ts";
import { buildProgram } from "../src/cli.ts";
import {
  parseJsonOption,
  parseOnboardingSection,
} from "../src/commands/onboarding.ts";

function subnames(program: ReturnType<typeof buildProgram>, name: string): string[] {
  const cmd = program.commands.find((c: { name: () => string }) => c.name() === name);
  return (cmd as { commands: readonly { name: () => string }[] }).commands.map((c) => c.name());
}

interface MirageFileIoBridge {
  canHandle?(path: unknown): boolean;
  readFileSync?(path: unknown, options?: unknown): string | Uint8Array | null;
}

function setFileIoBridge(bridge: MirageFileIoBridge): void {
  (
    globalThis as typeof globalThis & { __MIRAGE_CLI_FILE_IO__?: MirageFileIoBridge }
  ).__MIRAGE_CLI_FILE_IO__ = bridge;
}

afterEach(() => {
  delete (globalThis as typeof globalThis & { __MIRAGE_CLI_FILE_IO__?: unknown })
    .__MIRAGE_CLI_FILE_IO__;
});

describe("@mirage-cli/radar-cli", () => {
  test("buildProgram() returns a configured Commander program named radar", () => {
    const program = buildProgram();
    expect(program.name()).toBe("radar");
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
    const names = program.commands.map((c: { name: () => string }) => c.name());
    // AI-visibility V1 surface
    expect(names).toContain("projects");
    expect(names).toContain("queries");
    expect(names).toContain("game-plans");
    expect(names).toContain("results");
    expect(names).toContain("jobs");
    expect(names).toContain("credits");
    expect(names).toContain("export");
    expect(names).toContain("orgs");
    expect(names).toContain("onboarding");
    // auth
    expect(names).toContain("login");
    expect(names).toContain("whoami");
    expect(names).toContain("logout");
    // the old batch-jobs surface must be gone
    expect(names).not.toContain("models");
    expect(names).not.toContain("analytics");
  });

  test("projects exposes create alongside its read subcommands", () => {
    expect(subnames(buildProgram(), "projects")).toEqual(["create", "list", "get"]);
  });

  test("onboarding exposes exactly the supported six subcommands", () => {
    expect(subnames(buildProgram(), "onboarding")).toEqual([
      "create",
      "status",
      "analyze",
      "save",
      "generate-queries",
      "complete",
    ]);
  });

  test("onboarding section validation rejects unknown sections", () => {
    expect(() => parseOnboardingSection("unknown")).toThrow(
      "Expected one of: business, personas, competitors, funnelMix, location, domain",
    );
  });

  test("JSON options parse inline JSON and invalid JSON names the option", async () => {
    await expect(parseJsonOption<{ bofu: number }>('{"bofu":50}', "--funnel-mix")).resolves.toEqual({
      bofu: 50,
    });
    await expect(parseJsonOption("{bad", "--profile")).rejects.toThrow(
      "Invalid JSON for --profile",
    );
  });

  test("JSON options retain the node:fs @file fallback", async () => {
    const fixturePath = fileURLToPath(new URL("./fixtures/onboarding-data.json", import.meta.url));
    await expect(parseJsonOption<{ name: string }>(`@${fixturePath}`, "--data")).resolves.toEqual({
      name: "Example",
    });
  });

  test("JSON options read string content through the Mirage VFS bridge", async () => {
    setFileIoBridge({
      canHandle: (path) => path === "/data/x.json",
      readFileSync: () => '{"source":"bridge"}',
    });

    await expect(parseJsonOption("@/data/x.json", "--profile")).resolves.toEqual({
      source: "bridge",
    });
  });

  test("JSON options decode Uint8Array content from the Mirage VFS bridge", async () => {
    setFileIoBridge({
      canHandle: () => true,
      readFileSync: () => new TextEncoder().encode('{"queries":["one"]}'),
    });

    await expect(parseJsonOption("@/sessions/test/queries.json", "--queries")).resolves.toEqual({
      queries: ["one"],
    });
  });

  test("JSON options report a missing Mirage VFS path", async () => {
    setFileIoBridge({
      canHandle: () => true,
      readFileSync: () => null,
    });

    await expect(parseJsonOption("@/data/missing.json", "--data")).rejects.toThrow(
      /Could not read JSON for --data from \/data\/missing\.json:.*\/data\/missing\.json/,
    );
  });

  test("game-plans exposes read + write subcommands", () => {
    const program = buildProgram();
    const subs = subnames(program, "game-plans");
    expect(subs).toContain("list");
    expect(subs).toContain("get");
    expect(subs).toContain("update");
    expect(subs).toContain("complete-action");
  });

  test("orgs exposes multi-tenant subcommands", () => {
    const program = buildProgram();
    const subs = subnames(program, "orgs");
    expect(subs).toContain("list");
    expect(subs).toContain("use");
    expect(subs).toContain("current");
    expect(subs).toContain("clear");
  });

  test("program-level org/url/api-key flags are declared", () => {
    const program = buildProgram();
    const optionFlags = program.options.map((o: { long?: string }) => o.long);
    expect(optionFlags).toContain("--org");
    expect(optionFlags).toContain("--url");
    expect(optionFlags).toContain("--api-key");
  });
});

function byteStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("Radar SSE parsing", () => {
  test("parses events split across chunks and returns the final result", async () => {
    const statuses: string[] = [];
    const stream = byteStream([
      'data: {"type":"status","message":"Analy',
      'zing"}\n\ndata: {"type":"partial","data":{"step":1}}\n\ndata: {"type":"res',
      'ult","data":{"profile":{"version":0}}}\n\ndata: {"type":"result","data":{"profile":{"version":1}}}\n\ndata: {"type":"done"}\n\n',
    ]);

    await expect(parseSseStream(stream, statuses)).resolves.toEqual({
      profile: { version: 1 },
    });
    expect(statuses).toEqual(["Analyzing"]);
  });

  test("throws an ApiError when the stream reports an error", async () => {
    const promise = parseSseStream(
      byteStream(['data: {"type":"error","message":"analysis failed"}\n\n']),
    );
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toThrow("analysis failed");
  });

  test("throws when the stream ends without done", async () => {
    await expect(
      parseSseStream(byteStream(['data: {"type":"result","data":{"ok":true}}\n\n'])),
    ).rejects.toThrow("without a done event");
  });
});
