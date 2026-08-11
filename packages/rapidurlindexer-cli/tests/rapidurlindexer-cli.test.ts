import { afterEach, describe, expect, test } from "bun:test";
import { runCommander } from "@mirage-cli/core";
import {
  RapidUrlIndexerApiError,
  RapidUrlIndexerClient,
} from "../src/client.ts";
import { buildProgram } from "../src/cli.ts";
import { mergeUrls, parseUrlText, readUrlsFile } from "../src/urls.ts";

const decoder = new TextDecoder();
const originalFetch = globalThis.fetch;

function stubFetch(
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return impl as unknown as typeof fetch;
}

afterEach(() => {
  delete (globalThis as { __MIRAGE_CLI_FILE_IO__?: unknown }).__MIRAGE_CLI_FILE_IO__;
  globalThis.fetch = originalFetch;
});

describe("program shape", () => {
  test("exposes the documented credits and projects commands", () => {
    const program = buildProgram();
    expect(program.name()).toBe("rapidurlindexer");
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
    const names = program.commands.map((command) => command.name());
    expect(names).toEqual(["credits", "projects"]);
    const projects = program.commands.find((command) => command.name() === "projects")!;
    expect(projects.commands.map((command) => command.name())).toEqual([
      "list",
      "get",
      "create",
      "report",
    ]);
  });

  test("has no top-level submit alias", () => {
    expect(buildProgram().commands.map((command) => command.name())).not.toContain("submit");
  });
});

describe("URL ingestion", () => {
  test("parses comments and blanks, validates, and deduplicates in first-seen order", () => {
    expect(
      parseUrlText("\uFEFF# release\nhttps://example.com/a\n\n https://example.com/b \nhttps://example.com/a\n"),
    ).toEqual(["https://example.com/a", "https://example.com/b"]);
  });

  test("rejects non-HTTP URLs and embedded credentials", () => {
    expect(() => parseUrlText("file:///tmp/secret")).toThrow(/http/);
    expect(() => parseUrlText("https://user:pass@example.com/")).toThrow(/credentials/);
  });

  test("merges file and inline groups without duplicate credit spend", () => {
    expect(
      mergeUrls(
        ["https://example.com/a", "https://example.com/b"],
        ["https://example.com/b", "https://example.com/c"],
      ),
    ).toEqual([
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/c",
    ]);
  });

  test("reads mounted /sessions paths through the Mirage VFS bridge", async () => {
    let requested: unknown;
    (globalThis as { __MIRAGE_CLI_FILE_IO__?: unknown }).__MIRAGE_CLI_FILE_IO__ = {
      canHandle: (path: unknown) => path === "/sessions/s1/queue.txt",
      readFileSync: (path: unknown) => {
        requested = path;
        return "https://example.com/a\nhttps://example.com/b\n";
      },
    };
    expect(await readUrlsFile("/sessions/s1/queue.txt")).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(requested).toBe("/sessions/s1/queue.txt");
  });
});

describe("typed fetch client", () => {
  test("calls the runtime fetch with the global receiver", async () => {
    const originalFetch = globalThis.fetch;
    let receiver: unknown;
    globalThis.fetch = function (this: typeof globalThis) {
      receiver = this;
      return Promise.resolve(Response.json({ credits: 42 }));
    } as unknown as typeof fetch;
    try {
      const result = await new RapidUrlIndexerClient({ apiKey: "secret" }).getCreditBalance();
      expect(result).toEqual({ credits: 42 });
      expect(receiver).toBe(globalThis);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("uses X-API-Key and sends the documented create payload", async () => {
    let seen: { path: string; method: string; apiKey: string | null; body: unknown } | undefined;
    const client = new RapidUrlIndexerClient({
      apiKey: "secret",
      baseUrl: "https://rapidurlindexer.test/wp-json",
      fetch: stubFetch(async (input, init) => {
        const request = new Request(input, init);
        seen = {
          path: new URL(request.url).pathname,
          method: request.method,
          apiKey: request.headers.get("x-api-key"),
          body: await request.json(),
        };
        return Response.json({ message: "Project created successfully", project_id: 123 }, { status: 201 });
      }),
    });
    await client.createProject({
      project_name: "release",
      urls: ["https://example.com/page"],
      notify_on_status_change: false,
      apex_mode_enabled: true,
    });
    expect(seen).toEqual({
      path: "/wp-json/api/v1/projects",
      method: "POST",
      apiKey: "secret",
      body: {
        project_name: "release",
        urls: ["https://example.com/page"],
        notify_on_status_change: false,
        apex_mode_enabled: true,
      },
    });
  });

  test("negotiates JSON and CSV reports", async () => {
    const accepts: string[] = [];
    const client = new RapidUrlIndexerClient({
      apiKey: "secret",
      baseUrl: "https://rapidurlindexer.test",
      fetch: stubFetch(async (input, init) => {
        const request = new Request(input, init);
        const accept = request.headers.get("accept") ?? "";
        accepts.push(accept);
        if (accept === "text/csv") return new Response("URL,Status\nhttps://example.com,Indexed\n");
        return Response.json({ project_id: 9, project_name: "p", total_urls: 0, urls: [] });
      }),
    });
    expect((await client.getProjectReport(9)).project_id).toBe(9);
    expect(await client.getProjectReport(9, "csv")).toContain("URL,Status");
    expect(accepts).toEqual(["application/json", "text/csv"]);
  });

  test.each([
    [401, { message: "Invalid API key" }, "authentication"],
    [403, { code: "rest_forbidden", message: "API key is missing" }, "authentication"],
    [403, { message: "Insufficient credits" }, "forbidden"],
    [425, { message: "Report not yet available" }, "not_ready"],
    [429, { message: "Too many requests" }, "rate_limited"],
  ] as const)("classifies API status %s (%s)", async (status, body, kind) => {
    const client = new RapidUrlIndexerClient({
      apiKey: "secret",
      baseUrl: "https://rapidurlindexer.test",
      fetch: stubFetch(async () => Response.json(body, {
        status,
        headers: status === 429 ? { "Retry-After": "12" } : undefined,
      })),
    });
    try {
      await client.getCreditBalance();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RapidUrlIndexerApiError);
      expect((error as RapidUrlIndexerApiError).status).toBe(status);
      expect((error as RapidUrlIndexerApiError).kind).toBe(kind);
      if (status === 429) expect((error as RapidUrlIndexerApiError).retryAfterSeconds).toBe(12);
    }
  });
});

describe("Commander behavior", () => {
  test("creates a project from repeated URLs and prints machine-readable JSON", async () => {
    let body: unknown;
    globalThis.fetch = stubFetch(async (input, init) => {
      const request = new Request(input, init);
      body = await request.json();
      return Response.json(
        { message: "Project created successfully", project_id: 77 },
        { status: 201 },
      );
    });
    const result = await runCommander(buildProgram(), [
      "--api-key", "secret",
      "--base-url", "https://rapidurlindexer.test",
      "projects", "create",
      "--name", "release",
      "--url", "https://example.com/a",
      "--url", "https://example.com/b",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.costs).toEqual([{ provider: "rapidurlindexer", credits: 2 }]);
    expect(body).toMatchObject({ project_name: "release", urls: ["https://example.com/a", "https://example.com/b"] });
    expect(JSON.parse(decoder.decode(result.stdout))).toEqual({
      message: "Project created successfully",
      project_id: 77,
      submitted_urls: 2,
    });
  });

  test("a project status read reports no cost", async () => {
    globalThis.fetch = stubFetch(async () =>
      Response.json({
        project_id: 12,
        project_name: "release",
        status: "submitted",
        urls: ["https://example.com/a"],
        submitted_links: 1,
        indexed_links: 0,
        created_at: "2026-08-10T00:00:00Z",
        updated_at: "2026-08-10T00:00:00Z",
      }));
    const result = await runCommander(buildProgram(), [
      "--api-key", "secret",
      "--base-url", "https://rapidurlindexer.test",
      "projects", "get", "12",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.costs).toEqual([]);
  });

  test("prefers the API's submitted URL count when creation reports one", async () => {
    globalThis.fetch = stubFetch(async () =>
      Response.json(
        {
          message: "Project created successfully",
          project_id: 78,
          submitted_urls: 1,
        },
        { status: 201 },
      ));
    const result = await runCommander(buildProgram(), [
      "--api-key", "secret",
      "--base-url", "https://rapidurlindexer.test",
      "projects", "create",
      "--name", "release",
      "--url", "https://example.com/a",
      "--url", "https://example.com/b",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.costs).toEqual([{ provider: "rapidurlindexer", credits: 1 }]);
  });

  test("renders a structured 425 error on stderr", async () => {
    globalThis.fetch = stubFetch(async () =>
      Response.json({ message: "Report not yet available" }, { status: 425 }));
    const result = await runCommander(buildProgram(), [
      "--api-key", "secret",
      "--base-url", "https://rapidurlindexer.test",
      "projects", "report", "12",
    ]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(decoder.decode(result.stderr))).toMatchObject({
      status: 425,
      kind: "not_ready",
    });
  });
});
