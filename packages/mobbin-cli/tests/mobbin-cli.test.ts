import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the config at a throwaway file before the modules read it.
const dir = mkdtempSync(join(tmpdir(), "mobbin-cli-"));
process.env.MOBBIN_CLI_CONFIG = join(dir, "config.json");

const { buildProgram } = await import("../src/cli.ts");
const { callTool, parseRpcBody, resolveClient, structured, TOOL } = await import("../src/client.ts");
const { codeFromCallback, discover, ensureClient, pkce } = await import("../src/oauth.ts");
const { slug } = await import("../src/save.ts");

const MCP = "https://api.mobbin.example/mcp";
const ISSUER = "https://auth.mobbin.example/auth/v1";
const TOKEN_URL = `${ISSUER}/oauth/token`;
const realFetch = globalThis.fetch;

function saveLogin(expiresInMs: number) {
  writeFileSync(
    process.env.MOBBIN_CLI_CONFIG as string,
    JSON.stringify({
      oauth: {
        issuer: ISSUER,
        tokenEndpoint: TOKEN_URL,
        clientId: "client-1",
        accessToken: "old-access",
        refreshToken: "old-refresh",
        expiresAt: Date.now() + expiresInMs,
      },
    }),
  );
}
const saved = () => JSON.parse(readFileSync(process.env.MOBBIN_CLI_CONFIG as string, "utf8"));
const toolReply = (structuredContent: unknown, isError = false, text?: string) =>
  new Response(
    `event: message\ndata: ${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [
          { type: "text", text: text ?? JSON.stringify(structuredContent) },
          { type: "image", mimeType: "image/webp", data: "AAAA" },
        ],
        ...(isError ? { isError } : { structuredContent }),
      },
    })}\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
const tokenReply = (n: number) =>
  Response.json({ access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: 3600, token_type: "bearer" });

async function captureStdout(fn: () => Promise<unknown>): Promise<string> {
  const chunks: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = write;
  }
  return chunks.join("");
}

beforeEach(() => {
  delete process.env.MOBBIN_ACCESS_TOKEN;
  process.env.MOBBIN_MCP_URL = MCP;
  rmSync(process.env.MOBBIN_CLI_CONFIG as string, { force: true });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("program", () => {
  test("has the session, search and escape-hatch commands", () => {
    const names = buildProgram().commands.map((c) => c.name());
    for (const name of ["login", "logout", "status", "screens", "flows", "sections", "download", "tools", "call"]) {
      expect(names).toContain(name);
    }
  });

  test("is independent across calls", () => {
    expect(buildProgram()).not.toBe(buildProgram());
  });

  test("screens requires --platform", async () => {
    process.env.MOBBIN_ACCESS_TOKEN = "t";
    const program = buildProgram().exitOverride();
    for (const c of program.commands) c.exitOverride().configureOutput({ writeErr: () => {} });
    await expect(program.parseAsync(["screens", "login"], { from: "user" })).rejects.toThrow(/platform/);
  });

  test("slug makes safe file names", () => {
    expect(slug("Revolut Business!")).toBe("revolut-business");
    expect(slug("")).toBe("item");
  });
});

describe("oauth", () => {
  test("pkce challenge is the S256 of the verifier", async () => {
    const { verifier, challenge } = pkce();
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    expect(challenge).toBe(Buffer.from(digest).toString("base64url"));
  });

  test("discovers the issuer from the MCP endpoint's resource metadata", async () => {
    const urls: string[] = [];
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      urls.push(String(url));
      if (String(url).includes("oauth-protected-resource")) return Response.json({ authorization_servers: [ISSUER] });
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/oauth/authorize`,
        token_endpoint: TOKEN_URL,
        registration_endpoint: `${ISSUER}/oauth/clients/register`,
      });
    }) as unknown as typeof fetch;
    const as = await discover(MCP);
    expect(as.token_endpoint).toBe(TOKEN_URL);
    expect(urls[0]).toBe("https://api.mobbin.example/.well-known/oauth-protected-resource/mcp");
    expect(urls[1]).toBe(`${ISSUER}/.well-known/oauth-authorization-server`);
  });

  test("registers a public client once and reuses it for the same redirect URI", async () => {
    let registrations = 0;
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      registrations++;
      const body = JSON.parse(String(init?.body));
      expect(body.token_endpoint_auth_method).toBe("none");
      expect(body.redirect_uris).toEqual(["http://127.0.0.1:53684/callback"]);
      return Response.json({ client_id: "registered-1" });
    }) as unknown as typeof fetch;
    const as = {
      issuer: ISSUER,
      authorization_endpoint: "x",
      token_endpoint: TOKEN_URL,
      registration_endpoint: `${ISSUER}/oauth/clients/register`,
    };
    expect(await ensureClient(as, "http://127.0.0.1:53684/callback")).toBe("registered-1");
    expect(await ensureClient(as, "http://127.0.0.1:53684/callback")).toBe("registered-1");
    expect(registrations).toBe(1);
  });

  test("takes the code from a callback URL with the right state only", () => {
    const url = (q: string) => `http://127.0.0.1:53684/callback?${q}`;
    expect(codeFromCallback(url("code=abc&state=s1"), "s1")).toBe("abc");
    expect(() => codeFromCallback(url("code=abc&state=other"), "s1")).toThrow("state mismatch");
    expect(() => codeFromCallback(url("error=access_denied&state=s1"), "s1")).toThrow("access_denied");
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
      expect(String(init?.body)).toContain("client_id=client-1");
      return tokenReply(1);
    }) as unknown as typeof fetch;
    const client = await resolveClient();
    expect(client.token).toBe("access-1");
    expect(calls).toEqual([TOKEN_URL]);
    expect(saved().oauth.refreshToken).toBe("refresh-1");
  });

  test("a 401 mid-session refreshes once and retries", async () => {
    saveLogin(3_600_000);
    let mcpCalls = 0;
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === TOKEN_URL) return tokenReply(2);
      mcpCalls++;
      const auth = new Headers(init?.headers).get("authorization");
      return auth === "Bearer access-2" ? toolReply({ query: "q", screens: [] }) : new Response("", { status: 401 });
    }) as unknown as typeof fetch;
    const result = await callTool(await resolveClient(), TOOL.screens, { query: "q", platform: "ios" });
    expect(structured<unknown>(result)).toEqual({ query: "q", screens: [] });
    expect(mcpCalls).toBe(2);
    expect(saved().oauth.refreshToken).toBe("refresh-2");
  });

  test("MOBBIN_ACCESS_TOKEN is used as-is and never refreshed", async () => {
    process.env.MOBBIN_ACCESS_TOKEN = "injected";
    const client = await resolveClient();
    expect(client.token).toBe("injected");
    expect(client.onRefresh).toBeUndefined();
  });

  test("a tool-level error is thrown with the server's message", async () => {
    process.env.MOBBIN_ACCESS_TOKEN = "t";
    globalThis.fetch = mock(async () =>
      toolReply(null, true, "MCP error -32602: Input validation error: platform"),
    ) as unknown as typeof fetch;
    await expect(callTool(await resolveClient(), TOOL.screens, { query: "q" })).rejects.toThrow(
      "Input validation error",
    );
  });
});

describe("search commands", () => {
  const screen = (n: number) => ({
    id: `0000000${n}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    image_url: `https://img.example/${n}`,
    mobbin_url: `https://mobbin.com/screens/${n}`,
    app_name: `App ${n}`,
    platform: "ios",
  });

  test("screens sends the query, platform and hints; prints one row per screen and the usage notice", async () => {
    process.env.MOBBIN_ACCESS_TOKEN = "t";
    let args: Record<string, unknown> = {};
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      args = JSON.parse(String(init?.body)).params.arguments;
      return toolReply({
        query: "checkout",
        screens: [screen(1), screen(2)],
        ai_usage_notice: { text: "You have used **80%** of credits.", credits_used: 80 },
      });
    }) as unknown as typeof fetch;
    const out = await captureStdout(() =>
      buildProgram().parseAsync(
        ["screens", "checkout", "with", "apple", "pay", "--platform", "ios", "--mode", "standard", "--limit", "2", "--destination", "doc"],
        { from: "user" },
      ),
    );
    expect(args).toEqual({ query: "checkout with apple pay", platform: "ios", mode: "standard", limit: 2, output_destination: "doc" });
    expect(out).toContain("App 1 (ios)  https://mobbin.com/screens/1");
    expect(out).toContain("App 2 (ios)  https://mobbin.com/screens/2");
    expect(out).toContain("You have used **80%** of credits.");
  });

  test("--save downloads each screen's high-res image and reports the path", async () => {
    process.env.MOBBIN_ACCESS_TOKEN = "t";
    const saveDir = join(dir, "shots");
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      if (String(url).startsWith("https://img.example/")) {
        return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/webp" } });
      }
      return toolReply({ query: "q", screens: [screen(1)] });
    }) as unknown as typeof fetch;
    const out = await captureStdout(() =>
      buildProgram().parseAsync(["screens", "q", "--platform", "ios", "--save", saveDir, "--json"], { from: "user" }),
    );
    const path = join(saveDir, "app-1-00000001.webp");
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(out).screens[0].saved).toBe(path);
  });

  test("flows passes page and suggests the next page", async () => {
    process.env.MOBBIN_ACCESS_TOKEN = "t";
    let args: Record<string, unknown> = {};
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      args = JSON.parse(String(init?.body)).params.arguments;
      return toolReply({
        query: "onboarding",
        page: 2,
        has_next_page: true,
        flows: [{ ...screen(3), name: "Onboarding", screen_count: 12, screens: [] }],
      });
    }) as unknown as typeof fetch;
    const out = await captureStdout(() =>
      buildProgram().parseAsync(["flows", "onboarding", "--platform", "ios", "--page", "2"], { from: "user" }),
    );
    expect(args).toMatchObject({ query: "onboarding", platform: "ios", page: 2 });
    expect(out).toContain("App 3: Onboarding (ios, 12 screens)");
    expect(out).toContain("add --page 3");
  });

  test("sections needs no platform", async () => {
    process.env.MOBBIN_ACCESS_TOKEN = "t";
    let args: Record<string, unknown> = {};
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      args = JSON.parse(String(init?.body)).params.arguments;
      return toolReply({ query: "pricing", sections: [{ id: "x", image_url: "u", mobbin_url: "m", site_name: "Stripe" }] });
    }) as unknown as typeof fetch;
    const out = await captureStdout(() => buildProgram().parseAsync(["sections", "pricing"], { from: "user" }));
    expect(args).toEqual({ query: "pricing" });
    expect(out).toContain("Stripe  m");
  });
});

process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
