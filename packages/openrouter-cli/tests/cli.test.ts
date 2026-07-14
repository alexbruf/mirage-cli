import { afterEach, describe, expect, test } from "bun:test";
import { buildProgram } from "../src/cli.ts";

const originalFetch = globalThis.fetch;
const originalLog = console.log;
const originalKey = process.env.OPENROUTER_API_KEY;

type MirageFileIo = {
  canHandle(path: unknown): boolean;
  readFileSync(path: unknown, options?: unknown): string | Uint8Array | null;
  writeFileSync(path: unknown, data: unknown, options?: unknown): boolean;
};

function installFileIo(overrides: Partial<MirageFileIo> = {}): void {
  (
    globalThis as typeof globalThis & {
      __MIRAGE_CLI_FILE_IO__?: MirageFileIo;
    }
  ).__MIRAGE_CLI_FILE_IO__ = {
    canHandle: () => false,
    readFileSync: () => null,
    writeFileSync: () => false,
    ...overrides,
  };
}

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
    expect(names).toEqual(["chat", "generation", "images", "key", "models", "providers"]);
    expect(names).not.toContain("raw");
    expect(names).not.toContain("keys");
  });

  test("routes image model discovery and encoded endpoint lookups", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      return new Response(
        JSON.stringify(
          url.endsWith("/images/models")
            ? { data: [] }
            : { id: "openai/gpt-image-1", endpoints: [] },
        ),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as typeof fetch;
    console.log = () => {};

    await buildProgram().parseAsync(["node", "openrouter", "images", "models"]);
    await buildProgram().parseAsync([
      "node",
      "openrouter",
      "images",
      "endpoints",
      "openai/gpt-image-1",
    ]);

    expect(urls).toHaveLength(2);
    expect(new URL(urls[0]!).pathname).toBe("/api/v1/images/models");
    expect(new URL(urls[1]!).pathname).toBe(
      "/api/v1/images/models/openai/gpt-image-1/endpoints",
    );
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

  test("decodes image bytes exactly, writes through Mirage VFS, and omits base64 from stdout", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    const expected = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff,
    ]);
    const b64 = Buffer.from(expected).toString("base64");
    const writes = new Map<string, Uint8Array>();
    installFileIo({
      canHandle: (path) => typeof path === "string" && path.startsWith("/sessions/"),
      writeFileSync: (path, data) => {
        if (typeof path !== "string" || !(data instanceof Uint8Array)) return false;
        writes.set(path, Uint8Array.from(data));
        return true;
      },
    });
    let sent: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          created: 1_721_000_000,
          data: [{ b64_json: b64, media_type: "image/png" }],
          usage: { total_tokens: 42, cost: 0.04 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    const logs: string[] = [];
    console.log = (...values: unknown[]) => logs.push(values.map(String).join(" "));

    await buildProgram().parseAsync([
      "node",
      "openrouter",
      "images",
      "generate",
      "--model",
      "openai/gpt-image-1",
      "--prompt",
      "A blue orchid",
      "--output",
      "/sessions/session-1/orchid.png",
    ]);

    expect(sent).toMatchObject({
      model: "openai/gpt-image-1",
      prompt: "A blue orchid",
      stream: false,
    });
    expect([...writes.keys()]).toEqual(["/sessions/session-1/orchid.png"]);
    expect(writes.get("/sessions/session-1/orchid.png")).toEqual(expected);
    const output = logs.join("\n");
    expect(output).toContain("openai/gpt-image-1");
    expect(output).toContain("/sessions/session-1/orchid.png");
    expect(output).toContain('"cost": 0.04');
    expect(output).not.toContain(b64);
    expect(output).not.toContain("b64_json");
  });

  test("reads image requests and reference bytes from VFS while keeping the CLI model explicit", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    const requestPath = "/sessions/session-1/image-request.json";
    const referencePath = "/sessions/session-1/reference.webp";
    const outputPath = "/sessions/session-1/remix.webp";
    const referenceBytes = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x01, 0x02]);
    const outputBytes = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x03, 0x04]);
    const writes = new Map<string, Uint8Array>();
    installFileIo({
      canHandle: (path) => typeof path === "string" && path.startsWith("/sessions/"),
      readFileSync: (path, options) => {
        if (path === requestPath) {
          const json = JSON.stringify({
            model: "must-not-use/request-model",
            prompt: "Turn the reference into a watercolor",
            quality: "high",
          });
          return options === "utf8" ? json : new TextEncoder().encode(json);
        }
        if (path === referencePath) return referenceBytes;
        return null;
      },
      writeFileSync: (path, data) => {
        if (typeof path !== "string" || !(data instanceof Uint8Array)) return false;
        writes.set(path, Uint8Array.from(data));
        return true;
      },
    });
    let sent: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          created: 1_721_000_000,
          data: [{
            b64_json: Buffer.from(outputBytes).toString("base64"),
            media_type: "image/webp",
          }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    console.log = () => {};

    await buildProgram().parseAsync([
      "node",
      "openrouter",
      "images",
      "generate",
      "--model",
      "openai/gpt-image-1",
      "--request",
      requestPath,
      "--reference",
      referencePath,
      "--output",
      outputPath,
    ]);

    expect(sent).toMatchObject({
      model: "openai/gpt-image-1",
      prompt: "Turn the reference into a watercolor",
      quality: "high",
      n: 1,
      stream: false,
      input_references: [{
        type: "image_url",
        image_url: {
          url: `data:image/webp;base64,${Buffer.from(referenceBytes).toString("base64")}`,
        },
      }],
    });
    expect(writes.get(outputPath)).toEqual(outputBytes);
  });

  test("requires an explicit image model and output path before fetching", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches++;
      throw new Error("fetch must not run for an invalid command");
    }) as unknown as typeof fetch;

    const missingModel = buildProgram();
    missingModel.exitOverride();
    await expect(
      missingModel.parseAsync([
        "node",
        "openrouter",
        "images",
        "generate",
        "--prompt",
        "A blue orchid",
        "--output",
        "/sessions/session-1/orchid.png",
      ]),
    ).rejects.toThrow(/model/i);

    const missingOutput = buildProgram();
    missingOutput.exitOverride();
    await expect(
      missingOutput.parseAsync([
        "node",
        "openrouter",
        "images",
        "generate",
        "--model",
        "openai/gpt-image-1",
        "--prompt",
        "A blue orchid",
      ]),
    ).rejects.toThrow(/output/i);

    expect(fetches).toBe(0);
  });

  test("caps reference count before a billable request", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches++;
      throw new Error("fetch must not run for oversized reference input");
    }) as unknown as typeof fetch;
    const reference = `data:image/png;base64,${Buffer.from([1]).toString("base64")}`;

    const program = buildProgram();
    program.exitOverride();
    await expect(
      program.parseAsync([
        "node",
        "openrouter",
        "images",
        "generate",
        "--model",
        "openai/gpt-image-1",
        "--prompt",
        "A blue orchid",
        "--output",
        "/sessions/session-1/orchid.png",
        ...Array.from({ length: 5 }, () => ["--reference", reference]).flat(),
      ]),
    ).rejects.toThrow(/at most 4 reference/i);

    expect(fetches).toBe(0);
  });

  test("validates every returned image before writing any session artifact", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    const validB64 = Buffer.from(Uint8Array.from([1, 2, 3])).toString("base64");
    const writes: string[] = [];
    installFileIo({
      canHandle: (path) => typeof path === "string" && path.startsWith("/sessions/"),
      writeFileSync: (path) => {
        writes.push(String(path));
        return true;
      },
    });
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          created: 1_721_000_000,
          data: [
            { b64_json: validB64, media_type: "image/png" },
            { media_type: "image/png" },
          ],
          usage: { cost: 0.08 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;

    const program = buildProgram();
    program.exitOverride();
    await expect(
      program.parseAsync([
        "node",
        "openrouter",
        "images",
        "generate",
        "--model",
        "openai/gpt-image-1",
        "--prompt",
        "Two blue orchids",
        "--output",
        "/sessions/session-1/orchid.png",
      ]),
    ).rejects.toThrow(/image|base64|b64_json|data/i);

    expect(writes).toEqual([]);
  });
});
