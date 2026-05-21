import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface OAuthResult {
  accessToken: string;
  refreshToken: string | undefined;
  expiresAt: number;
  tokenEndpoint: string;
  clientId: string;
}

interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
}

interface AuthServerMetadata {
  registration_endpoint: string;
  authorization_endpoint: string;
  token_endpoint: string;
  scopes_supported?: string[];
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    const args = process.platform === "win32" ? ["", url] : [url];
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // ignore — user can paste the URL manually
  }
}

interface LoopbackCapture {
  port: number;
  waitForCode: () => Promise<{ code: string; state: string }>;
}

function startLoopbackListener(): Promise<LoopbackCapture> {
  return new Promise((resolve, reject) => {
    let resolveCode: (v: { code: string; state: string }) => void;
    let rejectCode: (e: Error) => void;
    const codePromise = new Promise<{ code: string; state: string }>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    const server = createServer((req, res) => {
      if (!req.url) return;
      const url = new URL(req.url, `http://127.0.0.1`);
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      if (error || !code || !state) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(
          `<html><body><h1>Login failed</h1><p>${error ?? "missing code"}</p></body></html>`,
        );
        rejectCode(new Error(error ?? "missing code/state"));
        server.close();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        `<html><body style="font-family:system-ui;padding:2rem"><h1>Radar CLI — signed in</h1><p>You can close this tab.</p></body></html>`,
      );
      resolveCode({ code, state });
      setTimeout(() => server.close(), 100);
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({ port: addr.port, waitForCode: () => codePromise });
    });
  });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${url} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/**
 * Interactive OAuth login via PKCE + loopback redirect. Discovers the auth
 * server from the API's protected-resource metadata, registers a new client
 * via RFC 7591 DCR, runs the consent flow, and returns token + refresh data.
 */
export async function runOAuthLogin(baseUrl: string): Promise<OAuthResult> {
  const prmUrl = `${baseUrl.replace(/\/$/, "")}/.well-known/oauth-protected-resource`;
  const prm = await fetchJson<ProtectedResourceMetadata>(prmUrl);
  const authServer = prm.authorization_servers?.[0];
  if (!authServer) throw new Error(`No authorization_servers in ${prmUrl}`);

  const asm = await fetchJson<AuthServerMetadata>(
    `${authServer.replace(/\/$/, "")}/.well-known/oauth-authorization-server`,
  );

  const { port, waitForCode } = await startLoopbackListener();
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const registration = await fetchJson<{ client_id: string }>(asm.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Radar CLI",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const clientId = registration.client_id;

  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
  const state = base64url(randomBytes(16));

  const authUrl = new URL(asm.authorization_endpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", "profile email");

  console.log(`Opening browser: ${authUrl.toString()}`);
  console.log(`If it doesn't open, paste the URL above into your browser.`);
  openBrowser(authUrl.toString());

  const { code, state: returnedState } = await waitForCode();
  if (returnedState !== state) throw new Error("OAuth state mismatch — aborting");

  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  });
  const tokens = await fetchJson<TokenResponse>(asm.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody.toString(),
  });

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    tokenEndpoint: asm.token_endpoint,
    clientId,
  };
}

/**
 * Refresh an OAuth access token using the stored refresh token.
 * Returns the new token bundle; caller persists. Refresh tokens may or may
 * not rotate — fall back to the existing one if the response omits it.
 */
export async function refreshAccessToken(args: {
  refreshToken: string;
  clientId: string;
  tokenEndpoint: string;
}): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: args.refreshToken,
    client_id: args.clientId,
  });
  const tokens = await fetchJson<TokenResponse>(args.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? args.refreshToken,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
}
