import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildProgram, run, VERSION, type CostReport } from "../src/index.ts";
import { io } from "../src/output.ts";

const originalFetch = globalThis.fetch;
const originalToken = process.env.VE_DYNAMITE_TOKEN;
const originalUrl = process.env.VE_DYNAMITE_API_URL;
const originalIo = { ...io };

type MirageFileIo = {
  canHandle(path: string): boolean;
  readFileSync(path: string): string | Uint8Array | null;
  writeFileSync(path: string, data: string | Uint8Array): boolean;
};

let stdout = "";
let stderr = "";
let requests: Request[] = [];

function respond(body: unknown, status = 200): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

function installFileIo(bridge: MirageFileIo | undefined): void {
  (globalThis as { __MIRAGE_CLI_FILE_IO__?: MirageFileIo }).__MIRAGE_CLI_FILE_IO__ = bridge;
}

beforeEach(() => {
  stdout = "";
  stderr = "";
  requests = [];
  io.stdout = (text) => void (stdout += text);
  io.stderr = (text) => void (stderr += text);
  process.env.VE_DYNAMITE_TOKEN = "ved_test";
  delete process.env.VE_DYNAMITE_API_URL;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.assign(io, originalIo);
  installFileIo(undefined);
  if (originalToken === undefined) delete process.env.VE_DYNAMITE_TOKEN;
  else process.env.VE_DYNAMITE_TOKEN = originalToken;
  if (originalUrl === undefined) delete process.env.VE_DYNAMITE_API_URL;
  else process.env.VE_DYNAMITE_API_URL = originalUrl;
});

describe("@mirage-cli/contentdynamite-cli", () => {
  test("names the program and prints its version", async () => {
    expect(buildProgram().name()).toBe("ve-dynamite");
    expect(await run(["--version"])).toBe(0);
    expect(stdout.trim()).toBe(VERSION);
  });

  test("standalone mode keeps login, watch and --url; mount mode drops them", () => {
    const names = (program: ReturnType<typeof buildProgram>) => program.commands.map((command) => command.name());
    const standalone = buildProgram();
    const mounted = buildProgram({ mount: true });
    expect(names(standalone)).toContain("login");
    expect(names(mounted)).not.toContain("login");
    expect(standalone.options.map((option) => option.long)).toContain("--url");
    expect(mounted.options.map((option) => option.long)).not.toContain("--url");
    const watch = (program: ReturnType<typeof buildProgram>) =>
      program.commands.find((command) => command.name() === "articles")!.commands.map((command) => command.name());
    expect(watch(standalone)).toContain("watch");
    expect(watch(mounted)).not.toContain("watch");
  });

  test("sends the token as a bearer to VE_DYNAMITE_API_URL", async () => {
    process.env.VE_DYNAMITE_API_URL = "https://dynamite.example";
    respond({ email: "a@example.com", username: "a", profile: null, role: "normal" });
    expect(await run(["whoami"], { mount: true })).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://dynamite.example/api/v1/auth/me");
    expect(requests[0]!.headers.get("authorization")).toBe("Bearer ved_test");
    expect(JSON.parse(stdout).email).toBe("a@example.com");
  });

  test("reports one paid unit when the API accepts an article", async () => {
    const reports: CostReport[] = [];
    respond({ article_id: 7 });
    const code = await run(["articles", "write", "--profile-id", "1", "--query", "best plumbers", "--primary-keywords", "plumber"], {
      mount: true,
      reportCost: (report) => reports.push(report),
    });
    expect(code).toBe(0);
    expect(requests[0]!.method).toBe("POST");
    expect(reports).toEqual([{ provider: "contentdynamite", units: 1 }]);
  });

  test("an API error exits 1 with the server's detail on stderr and reports no cost", async () => {
    const reports: CostReport[] = [];
    respond({ detail: "Company profile not found" }, 404);
    const code = await run(["articles", "write", "--profile-id", "9", "--query", "q", "--primary-keywords", "k"], {
      mount: true,
      reportCost: (report) => reports.push(report),
    });
    expect(code).toBe(1);
    expect(stderr).toContain("404: Company profile not found");
    expect(reports).toEqual([]);
  });

  test("writes -o targets through the Mirage file bridge", async () => {
    const written = new Map<string, string>();
    installFileIo({
      canHandle: (path) => path.startsWith("/data/"),
      readFileSync: () => null,
      writeFileSync: (path, data) => {
        written.set(path, typeof data === "string" ? data : new TextDecoder().decode(data));
        return true;
      },
    });
    respond({ articles: [{ article_id: 1, status: "success" }], total_pages: 1 });
    expect(await run(["articles", "export", "-o", "/data/articles.json"], { mount: true })).toBe(0);
    expect(JSON.parse(written.get("/data/articles.json")!)).toEqual([{ article_id: 1, status: "success" }]);
  });

  test("refuses to run without a token in mount mode", async () => {
    delete process.env.VE_DYNAMITE_TOKEN;
    respond({});
    expect(await run(["whoami"], { mount: true })).toBe(1);
    expect(requests).toHaveLength(0);
  });
});
