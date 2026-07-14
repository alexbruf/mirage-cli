import { afterEach, describe, expect, test } from "bun:test";
import { buildProgram } from "../src/cli.ts";

const originalFetch = globalThis.fetch;
const originalLog = console.log;
const originalKey = process.env.OPENROUTER_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalLog;
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
  delete (globalThis as typeof globalThis & { __MIRAGE_CLI_FILE_IO__?: unknown })
    .__MIRAGE_CLI_FILE_IO__;
});

describe("openrouter CLI", () => {
  test("registers only the curated top-level command surface", () => {
    const names = buildProgram().commands.map((command) => command.name()).sort();
    expect(names).toEqual(["chat", "generation", "key", "models", "providers"]);
    expect(names).not.toContain("raw");
    expect(names).not.toContain("keys");
  });

  test("missing API key throws without persisting credentials", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const program = buildProgram();
    program.exitOverride();
    await expect(program.parseAsync(["node", "openrouter", "key"])).rejects.toThrow(
      /OPENROUTER_API_KEY/,
    );
  });

  test("reads a request file through the Mirage VFS bridge before node:fs", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    const requestBody = {
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: "hello from vfs" }],
    };
    (
      globalThis as typeof globalThis & {
        __MIRAGE_CLI_FILE_IO__?: {
          canHandle(path: unknown): boolean;
          readFileSync(path: unknown, options?: unknown): string | null;
        };
      }
    ).__MIRAGE_CLI_FILE_IO__ = {
      canHandle: (path) => path === "/sessions/request.json",
      readFileSync: (path) =>
        path === "/sessions/request.json" ? JSON.stringify(requestBody) : null,
    };
    let sent: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          id: "gen-1",
          model: "openai/gpt-4o",
          choices: [{ message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
          usage: { total_tokens: 4 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    const logs: string[] = [];
    console.log = (...values: unknown[]) => logs.push(values.map(String).join(" "));

    await buildProgram().parseAsync([
      "node",
      "openrouter",
      "-f",
      "text",
      "chat",
      "--request",
      "/sessions/request.json",
    ]);

    expect(sent?.model).toBe("openai/gpt-4o");
    expect(sent?.max_completion_tokens).toBe(2048);
    expect(sent?.stream).toBe(false);
    expect(logs).toEqual(["hello"]);
  });
});
