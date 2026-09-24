import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the config at a throwaway file before the modules read it.
const dir = mkdtempSync(join(tmpdir(), "markup-cli-"));
process.env.MARKUP_CLI_CONFIG = join(dir, "config.json");

const { buildProgram, parseRect } = await import("../src/cli.ts");
const { callTool, parseRpcBody, resolveClient, TOOL } = await import("../src/client.ts");
const { clientIdFor, codeFromCallback, pkce } = await import("../src/oauth.ts");

const HOST = "https://markup.example";
const realFetch = globalThis.fetch;

function saveLogin(expiresInMs: number) {
  writeFileSync(
    process.env.MARKUP_CLI_CONFIG as string,
    JSON.stringify({
      host: HOST,
      oauth: {
        issuer: HOST,
        clientId: clientIdFor(HOST),
        accessToken: "old-access",
        refreshToken: "old-refresh",
        expiresAt: Date.now() + expiresInMs,
      },
    }),
  );
}
const saved = () => JSON.parse(readFileSync(process.env.MARKUP_CLI_CONFIG as string, "utf8"));
const toolReply = (value: unknown, isError = false) =>
  new Response(
    `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(value) }], isError } })}\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
const tokenReply = (n: number) =>
  Response.json({ access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: 3600, token_type: "bearer" });

beforeEach(() => {
  delete process.env.MARKUP_TOKEN;
  delete process.env.MARKUP_AGENT;
  process.env.MARKUP_HOST = HOST;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("program", () => {
  test("has the session, board and annotation commands", () => {
    const program = buildProgram();
    expect(program.name()).toBe("markup");
    const names = program.commands.map((c) => c.name());
    for (const name of ["login", "logout", "boards", "create", "list", "watch", "comment", "resolve", "call"]) {
      expect(names).toContain(name);
    }
  });

  test("is independent across calls", () => {
    expect(buildProgram()).not.toBe(buildProgram());
  });

  test("parseRect takes x,y,w,h and accumulates", () => {
    expect(parseRect("1,2,3,4", parseRect("5,6,7,8"))).toEqual([
      { x: 5, y: 6, width: 7, height: 8 },
      { x: 1, y: 2, width: 3, height: 4 },
    ]);
    expect(() => parseRect("1,2,3")).toThrow();
  });
});

describe("oauth", () => {
  test("client_id is the deployment's metadata document", () => {
    expect(clientIdFor(HOST)).toBe(`${HOST}/cli/oauth-client.json`);
  });

  test("pkce challenge is the S256 of the verifier", async () => {
    const { verifier, challenge } = pkce();
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    expect(challenge).toBe(Buffer.from(digest).toString("base64url"));
  });
});

describe("client", () => {
  test("parses both JSON and SSE replies", () => {
    expect(parseRpcBody('{"id":1}')).toEqual({ id: 1 });
    expect(parseRpcBody('event: message\ndata: {"id":2}\n\n')).toEqual({ id: 2 });
  });

  test("refreshes an access token that is about to expire, and saves the rotated refresh token", async () => {
    saveLogin(10_000); // inside the 60s skew
    const calls: string[] = [];
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url));
      expect(String(init?.body)).toContain("refresh_token=old-refresh");
      return tokenReply(1);
    }) as unknown as typeof fetch;
    const client = await resolveClient();
    expect(client.token).toBe("access-1");
    expect(calls).toEqual([`${HOST}/oauth/token`]);
    expect(saved().oauth.refreshToken).toBe("refresh-1");
  });

  test("a 401 mid-session refreshes once and retries", async () => {
    saveLogin(3_600_000);
    let mcpCalls = 0;
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/oauth/token")) return tokenReply(2);
      mcpCalls++;
      const auth = new Headers(init?.headers).get("authorization");
      return auth === "Bearer access-2" ? toolReply([{ id: "b1" }]) : new Response("", { status: 401 });
    }) as unknown as typeof fetch;
    const boards = await callTool(await resolveClient(), TOOL.listBoards);
    expect(boards).toEqual([{ id: "b1" }]);
    expect(mcpCalls).toBe(2);
    expect(saved().oauth.refreshToken).toBe("refresh-2");
  });

  test("--as overrides MARKUP_AGENT, and comment pins to a selector without x/y", async () => {
    process.env.MARKUP_TOKEN = "injected";
    process.env.MARKUP_AGENT = "Host Default";
    const calls: { url: string; body: string }[] = [];
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return toolReply({ id: "a1", status: "open" });
    }) as unknown as typeof fetch;
    const out = console.log;
    console.log = () => {};
    try {
      await buildProgram().parseAsync(
        ["--as", "Jane Doe", "comment", "b1", "fix this", "--selector", "#cta", "--tag", "a", "--markdown", "`<a>`", "--json"],
        { from: "user" },
      );
    } finally {
      console.log = out;
    }
    expect(new URL(String(calls[0]?.url)).searchParams.get("agent")).toBe("Jane Doe");
    const args = JSON.parse(String(calls[0]?.body)).params.arguments;
    expect(args).toMatchObject({ room: "b1", text: "fix this", selector: "#cta" });
    expect(args.x).toBeUndefined();
  });

  test("comment without a selector still needs coordinates", async () => {
    process.env.MARKUP_TOKEN = "injected";
    globalThis.fetch = mock(async () => toolReply({})) as unknown as typeof fetch;
    await expect(
      buildProgram().exitOverride().parseAsync(["comment", "b1", "hi"], { from: "user" }),
    ).rejects.toThrow(/--x and --y, or --selector/);
  });

  test("MARKUP_AGENT names the participant on every MCP call", async () => {
    process.env.MARKUP_TOKEN = "injected";
    process.env.MARKUP_AGENT = "  Jane Doe via Brain  ";
    const urls: string[] = [];
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      urls.push(String(url));
      return toolReply([]);
    }) as unknown as typeof fetch;
    await callTool(await resolveClient(), TOOL.listBoards);
    expect(new URL(String(urls[0])).searchParams.get("agent")).toBe("Jane Doe via Brain");
  });

  test("the participant defaults to markup-cli", async () => {
    process.env.MARKUP_TOKEN = "injected";
    const urls: string[] = [];
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      urls.push(String(url));
      return toolReply([]);
    }) as unknown as typeof fetch;
    await callTool(await resolveClient(), TOOL.listBoards);
    expect(new URL(String(urls[0])).searchParams.get("agent")).toBe("markup-cli");
  });

  test("MARKUP_TOKEN is used as-is and never refreshed", async () => {
    process.env.MARKUP_TOKEN = "injected";
    const client = await resolveClient();
    expect(client.token).toBe("injected");
    expect(client.onRefresh).toBeUndefined();
  });

  test("a tool-level error is thrown with the server's message", async () => {
    process.env.MARKUP_TOKEN = "t";
    globalThis.fetch = mock(async () => toolReply({ error: "annotation not found: x" }, true)) as unknown as typeof fetch;
    await expect(callTool(await resolveClient(), TOOL.get, { room: "r", id: "x" })).rejects.toThrow(
      "annotation not found: x",
    );
  });
});

process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

describe("login callback", () => {
  const url = (q: string) => `http://127.0.0.1:53683/callback?${q}`;

  test("takes the code from a pasted callback URL with the right state", () => {
    expect(codeFromCallback(`  ${url("code=abc%3Adef&state=s1&iss=x")}  `, "s1")).toBe("abc:def");
  });

  test("refuses a URL from another login attempt, one without a code, and non-URLs", () => {
    expect(() => codeFromCallback(url("code=abc&state=other"), "s1")).toThrow("state mismatch");
    expect(() => codeFromCallback(url("state=s1"), "s1")).toThrow("no ?code=");
    expect(() => codeFromCallback(url("error=access_denied&state=s1"), "s1")).toThrow("access_denied");
    expect(() => codeFromCallback("not a url", "s1")).toThrow("not a URL");
  });
});
