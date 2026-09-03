import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runCommander } from "@mirage-cli/core";
import { ContentDynamiteApiError, ContentDynamiteClient } from "../src/client.ts";
import { buildProgram } from "../src/cli.ts";
import {
  interactiveFields,
  jobsToCsv,
  wireArticleStatus,
  wireLandingStatus,
  wirePageType,
} from "../src/wire.ts";

const decoder = new TextDecoder();
const originalFetch = globalThis.fetch;
const originalToken = process.env.VE_DYNAMITE_TOKEN;
const originalUrl = process.env.VE_DYNAMITE_API_URL;

function stubFetch(
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return impl as unknown as typeof fetch;
}

beforeEach(() => {
  delete process.env.VE_DYNAMITE_TOKEN;
  delete process.env.VE_DYNAMITE_API_URL;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.VE_DYNAMITE_TOKEN;
  else process.env.VE_DYNAMITE_TOKEN = originalToken;
  if (originalUrl === undefined) delete process.env.VE_DYNAMITE_API_URL;
  else process.env.VE_DYNAMITE_API_URL = originalUrl;
});

describe("program shape", () => {
  test("exposes the curated command surface", () => {
    const program = buildProgram();
    expect(program.name()).toBe("ve-dynamite");
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
    expect(program.commands.map((command) => command.name())).toEqual([
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

  test("has no login, logout, or credential storage commands", () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name());
    expect(names).not.toContain("login");
    expect(names).not.toContain("logout");
    const tokens = program.commands.find((command) => command.name() === "tokens")!;
    expect(tokens.commands.map((command) => command.name())).toEqual(["create", "list", "revoke"]);
  });

  test("has no watch commands anywhere", () => {
    const program = buildProgram();
    for (const group of program.commands) {
      expect(group.commands.map((command) => command.name())).not.toContain("watch");
    }
    const articles = program.commands.find((command) => command.name() === "articles")!;
    expect(articles.commands.map((command) => command.name())).toEqual([
      "write",
      "get",
      "list",
      "update",
      "delete",
      "export",
    ]);
    const landingPages = program.commands.find((command) => command.name() === "landing-pages")!;
    expect(landingPages.commands.map((command) => command.name())).toEqual([
      "write",
      "get",
      "list",
      "update",
      "fix-images",
      "delete",
      "export",
    ]);
  });
});

describe("wire mapping", () => {
  test("article status uses the wire spelling sucess", () => {
    expect(wireArticleStatus("success")).toBe("sucess");
    expect(wireArticleStatus("sucess")).toBe("sucess");
    expect(wireArticleStatus("pending")).toBe("pending");
    expect(() => wireArticleStatus("done")).toThrow(/invalid status/);
  });

  test("landing status uses the correct spelling success", () => {
    expect(wireLandingStatus("sucess")).toBe("success");
    expect(wireLandingStatus("success")).toBe("success");
    expect(() => wireLandingStatus("done")).toThrow(/invalid status/);
  });

  test("page types accept hyphens and lowercase to wire form", () => {
    expect(wirePageType("single-product")).toBe("single_product");
    expect(wirePageType("Multiple_Products")).toBe("multiple_products");
    expect(() => wirePageType("landing")).toThrow(/invalid page type/);
  });

  test("interactive flag maps bare and typed forms", () => {
    expect(interactiveFields(undefined)).toEqual({});
    expect(interactiveFields(true)).toEqual({ generate_interactive: true });
    expect(interactiveFields("quiz")).toEqual({ generate_interactive: true, interactive_type: "quiz" });
    expect(() => interactiveFields("poll")).toThrow(/invalid interactive type/);
  });

  test("jobs files convert to the batch CSV contract", () => {
    const csv = decoder.decode(
      jobsToCsv([
        {
          company_profile_id: 3,
          search_query: "best gravel, delivered",
          primary_keywords: "gravel",
          internal_links: ["https://a.example/x", "https://a.example/y"],
          generate_video: true,
        },
        { company_profile_id: 3, search_query: "pea gravel", primary_keywords: "pea gravel" },
      ]),
    );
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe("company_profile_id,search_query,primary_keywords,internal_links,generate_video");
    expect(lines[1]).toBe('3,"best gravel, delivered",gravel,https://a.example/x|https://a.example/y,true');
    expect(lines[2]).toBe("3,pea gravel,pea gravel,,");
  });

  test("jobs files reject per job guidelines and unknown fields", () => {
    expect(() =>
      jobsToCsv([{ company_profile_id: 1, search_query: "q", primary_keywords: "k", extra_guidelines: "x" }]),
    ).toThrow(/per job guidelines/);
    expect(() =>
      jobsToCsv([{ company_profile_id: 1, search_query: "q", primary_keywords: "k", watch: true }]),
    ).toThrow(/unknown field/);
    expect(() => jobsToCsv([])).toThrow(/non empty/);
  });
});

describe("typed fetch client", () => {
  test("calls the runtime fetch with the global receiver", async () => {
    let receiver: unknown;
    globalThis.fetch = function (this: typeof globalThis) {
      receiver = this;
      return Promise.resolve(Response.json([]));
    } as unknown as typeof fetch;
    const result = await new ContentDynamiteClient({ token: "ved_secret" }).get("company-profile/");
    expect(result).toEqual([]);
    expect(receiver).toBe(globalThis);
  });

  test("sends bearer auth to the /api/v1 path and drops empty params", async () => {
    let seen: { url: string; auth: string | null } | undefined;
    const client = new ContentDynamiteClient({
      token: "ved_secret",
      baseUrl: "https://dynamite.test",
      fetch: stubFetch(async (input, init) => {
        const request = new Request(input, init);
        seen = { url: request.url, auth: request.headers.get("authorization") };
        return Response.json({ articles: [], total_pages: 1 });
      }),
    });
    await client.get("content-writing/articles", { page: 1, limit: 10, company_name: undefined, status: "" });
    expect(seen).toEqual({
      url: "https://dynamite.test/api/v1/content-writing/articles?page=1&limit=10",
      auth: "Bearer ved_secret",
    });
  });

  test("uploads send file_type as a query param with a multipart body", async () => {
    let seen: { url: string; fileName: string; fileText: string } | undefined;
    const client = new ContentDynamiteClient({
      token: "ved_secret",
      baseUrl: "https://dynamite.test",
      fetch: stubFetch(async (input, init) => {
        const request = new Request(input, init);
        const form = await request.formData();
        const file = form.get("file") as File;
        seen = { url: request.url, fileName: file.name, fileText: await file.text() };
        return Response.json({ url: "https://cdn.test/x.csv" });
      }),
    });
    await client.postForm("upload/", "jobs.csv", new TextEncoder().encode("a,b\n"), "text/csv", {
      file_type: "csv",
    });
    expect(seen).toEqual({
      url: "https://dynamite.test/api/v1/upload/?file_type=csv",
      fileName: "jobs.csv",
      fileText: "a,b\n",
    });
  });

  test("maps FastAPI error details and statuses to kinds", async () => {
    const client = (status: number, body: unknown) =>
      new ContentDynamiteClient({
        token: "ved_secret",
        baseUrl: "https://dynamite.test",
        fetch: stubFetch(async () => Response.json(body, { status })),
      });
    try {
      await client(401, { detail: "invalid token" }).get("company-profile/");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ContentDynamiteApiError);
      expect((error as ContentDynamiteApiError).kind).toBe("authentication");
      expect((error as ContentDynamiteApiError).message).toContain("invalid token");
    }
    try {
      await client(422, {
        detail: [{ loc: ["body", "keyword"], msg: "field required" }],
      }).post("landing-pages/", {});
      expect.unreachable();
    } catch (error) {
      expect((error as ContentDynamiteApiError).kind).toBe("validation");
      expect((error as ContentDynamiteApiError).message).toContain("keyword: field required");
    }
    try {
      await client(409, { detail: "article is still being written" }).put("content-writing/article/1", {});
      expect.unreachable();
    } catch (error) {
      expect((error as ContentDynamiteApiError).kind).toBe("conflict");
    }
  });

  test("never follows redirects", async () => {
    const client = new ContentDynamiteClient({
      token: "ved_secret",
      baseUrl: "https://dynamite.test",
      fetch: stubFetch(async (input, init) => {
        expect(new Request(input, init).redirect).toBe("manual");
        return new Response(null, { status: 307, headers: { Location: "/api/v1/upload" } });
      }),
    });
    try {
      await client.post("upload/", {});
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ContentDynamiteApiError);
      expect((error as ContentDynamiteApiError).status).toBe(307);
    }
  });
});

describe("Commander behavior", () => {
  test("fails without a token and names the env var", async () => {
    const result = await runCommander(buildProgram(), ["profiles", "list"]);
    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stderr)).toContain("VE_DYNAMITE_TOKEN");
  });

  test("reads the token from the environment at call time", async () => {
    process.env.VE_DYNAMITE_TOKEN = "ved_env";
    let auth: string | null | undefined;
    globalThis.fetch = stubFetch(async (input, init) => {
      auth = new Request(input, init).headers.get("authorization");
      return Response.json([]);
    });
    const result = await runCommander(buildProgram(), ["profiles", "list"]);
    expect(result.exitCode).toBe(0);
    expect(auth).toBe("Bearer ved_env");
  });

  test("articles write posts the wire body and reports one unit of cost", async () => {
    let body: unknown;
    globalThis.fetch = stubFetch(async (input, init) => {
      body = await new Request(input, init).json();
      return Response.json({ msg: "started", article_id: 77 });
    });
    const result = await runCommander(buildProgram(), [
      "--token", "ved_secret",
      "--url", "https://dynamite.test",
      "articles", "write",
      "--profile-id", "3",
      "--query", "best gravel driveway",
      "--primary-keywords", "gravel driveway",
      "--competitor-links", "https://a.example, https://b.example",
      "--interactive", "quiz",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.costs).toEqual([{ provider: "contentdynamite", units: 1 }]);
    expect(body).toEqual({
      company_profile_id: 3,
      search_query: "best gravel driveway",
      primary_keywords: "gravel driveway",
      competitor_links: ["https://a.example", "https://b.example"],
      generate_interactive: true,
      interactive_type: "quiz",
    });
    expect(JSON.parse(decoder.decode(result.stdout))).toEqual({ msg: "started", article_id: 77 });
  });

  test("articles list maps success to the wire spelling", async () => {
    let url = "";
    globalThis.fetch = stubFetch(async (input, init) => {
      url = new Request(input, init).url;
      return Response.json({ articles: [], total_pages: 1 });
    });
    const result = await runCommander(buildProgram(), [
      "--token", "ved_secret",
      "--url", "https://dynamite.test",
      "articles", "list", "--status", "success",
    ]);
    expect(result.exitCode).toBe(0);
    expect(url).toContain("status=sucess");
  });

  test("a read reports no cost", async () => {
    globalThis.fetch = stubFetch(async () => Response.json([]));
    const result = await runCommander(buildProgram(), [
      "--token", "ved_secret",
      "profiles", "list",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.costs).toEqual([]);
  });

  test("deletes require an explicit --yes before any request is made", async () => {
    let called = false;
    globalThis.fetch = stubFetch(async () => {
      called = true;
      return Response.json({});
    });
    for (const argv of [
      ["articles", "delete", "5"],
      ["batches", "delete", "5"],
      ["profiles", "delete", "5"],
      ["landing-pages", "delete", "5"],
    ]) {
      const result = await runCommander(buildProgram(), ["--token", "ved_secret", ...argv]);
      expect(result.exitCode).toBe(1);
      expect(decoder.decode(result.stderr)).toContain("--yes");
    }
    expect(called).toBe(false);
  });

  test("landing-pages write enforces the paired intent flags", async () => {
    globalThis.fetch = stubFetch(async () => Response.json({ landing_page_id: 1 }));
    const result = await runCommander(buildProgram(), [
      "--token", "ved_secret",
      "landing-pages", "write",
      "--profile-id", "3",
      "--keyword", "buy pea gravel",
      "--page-type", "single_product",
      "--cta-label", "Get a quote",
      "--intent-who", "homeowners",
    ]);
    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stderr)).toContain("--intent-achieve");
  });

  test("batches create sends multipart CSV with query params and reports the batch size", async () => {
    (globalThis as { __MIRAGE_CLI_FILE_IO__?: unknown }).__MIRAGE_CLI_FILE_IO__ = {
      canHandle: (path: unknown) => path === "/data/jobs.json",
      readFileSync: () =>
        JSON.stringify([
          { company_profile_id: 3, search_query: "a", primary_keywords: "a" },
          { company_profile_id: 3, search_query: "b", primary_keywords: "b" },
        ]),
    };
    let seen: { url: string; csv: string } | undefined;
    globalThis.fetch = stubFetch(async (input, init) => {
      const request = new Request(input, init);
      const form = await request.formData();
      seen = { url: request.url, csv: await (form.get("file") as File).text() };
      return Response.json({ msg: "started", batch_id: 9, total: 2 });
    });
    try {
      const result = await runCommander(buildProgram(), [
        "--token", "ved_secret",
        "--url", "https://dynamite.test",
        "batches", "create", "--name", "release", "--jobs", "/data/jobs.json", "--video",
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.costs).toEqual([{ provider: "contentdynamite", units: 2 }]);
      expect(seen!.url).toBe(
        "https://dynamite.test/api/v1/content-writing/articles/batch?batch_name=release&generate_video=true",
      );
      expect(seen!.csv).toBe(
        "company_profile_id,search_query,primary_keywords\n3,a,a\n3,b,b\n",
      );
    } finally {
      delete (globalThis as { __MIRAGE_CLI_FILE_IO__?: unknown }).__MIRAGE_CLI_FILE_IO__;
    }
  });

  test("renders a structured API error on stderr", async () => {
    globalThis.fetch = stubFetch(async () =>
      Response.json({ detail: "landing page not found" }, { status: 404 }));
    const result = await runCommander(buildProgram(), [
      "--token", "ved_secret",
      "landing-pages", "get", "424",
    ]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(decoder.decode(result.stderr))).toMatchObject({
      status: 404,
      kind: "not_found",
    });
  });
});
