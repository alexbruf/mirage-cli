/**
 * Google OAuth (PKCE loopback) for the GA4 CLI.
 *
 * Required env vars (no built-in client defaults are shipped — register your
 * own OAuth client in the Google Cloud console and set):
 *
 *   GA4_OAUTH_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
 *   GA4_OAUTH_CLIENT_SECRET=<your-client-secret>     # optional for installed
 *                                                    # apps (Google still
 *                                                    # accepts it, but PKCE
 *                                                    # is the gating factor)
 *
 * Optional env vars:
 *
 *   GA4_OAUTH_SCOPES=<space-separated>               # default: analytics.readonly
 *   GA4_OAUTH_PORT=<number>                          # default: 53683
 *
 * Tokens are stored at ~/.config/google-analytics-cli/oauth.json (600 perms).
 */

import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".config", "google-analytics-cli");
const OAUTH_FILE = join(CONFIG_DIR, "oauth.json");
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_SCOPES = "https://www.googleapis.com/auth/analytics.readonly";

export interface OAuthState {
  issuer: "https://accounts.google.com";
  clientId: string;
  clientSecret?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}

export function oauthFilePath(): string {
  return OAUTH_FILE;
}

export function loadOAuthState(): OAuthState | null {
  if (!existsSync(OAUTH_FILE)) return null;
  try {
    return JSON.parse(readFileSync(OAUTH_FILE, "utf8")) as OAuthState;
  } catch {
    return null;
  }
}

function writeOAuthState(state: OAuthState): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(OAUTH_FILE, JSON.stringify(state, null, 2) + "\n");
  try {
    chmodSync(OAUTH_FILE, 0o600);
  } catch {
    /* non-POSIX */
  }
}

export function clearOAuthState(): void {
  if (existsSync(OAUTH_FILE)) unlinkSync(OAUTH_FILE);
}

const b64url = (buf: Buffer): string =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function pkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  import("node:child_process")
    .then(({ spawn }) => {
      spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
    })
    .catch(() => {});
}

export interface LoginOpts {
  clientId?: string;
  clientSecret?: string;
  scopes?: string;
  port?: number;
}

export async function login(opts: LoginOpts = {}): Promise<OAuthState> {
  const clientId = opts.clientId ?? process.env.GA4_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "No OAuth client_id configured. Set GA4_OAUTH_CLIENT_ID or pass --client-id.\n" +
        "Register an OAuth 2.0 Client ID (type: Desktop app) at\n" +
        "https://console.cloud.google.com/apis/credentials and add it to your env.",
    );
  }
  const clientSecret = opts.clientSecret ?? process.env.GA4_OAUTH_CLIENT_SECRET;
  const scopes = opts.scopes ?? process.env.GA4_OAUTH_SCOPES ?? DEFAULT_SCOPES;
  const port = opts.port ?? Number(process.env.GA4_OAUTH_PORT ?? 53683);
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const state = b64url(randomBytes(16));
  const { verifier, challenge } = pkce();

  const authUrl = new URL(AUTH_URL);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  console.log("Opening browser to log in to Google...");
  console.log(`If it doesn't open, visit:\n  ${authUrl.toString()}`);
  openBrowser(authUrl.toString());

  const code = await waitForCode(port, state);
  const tokens = await exchangeCode({
    clientId,
    clientSecret,
    code,
    verifier,
    redirectUri,
  });
  const next: OAuthState = {
    issuer: "https://accounts.google.com",
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? "",
    expiresAt: Date.now() + tokens.expires_in * 1000,
    scope: tokens.scope ?? scopes,
  };
  if (!next.refreshToken) {
    throw new Error(
      "Google did not return a refresh_token. Ensure the OAuth client is type 'Desktop app' and that consent was freshly granted.",
    );
  }
  writeOAuthState(next);
  return next;
}

function waitForCode(port: number, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end("not found");
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const err = url.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (err) {
        res.end(`<h1>Login failed</h1><p>${err}</p>`);
        server.close();
        reject(new Error(`OAuth error: ${err}`));
        return;
      }
      if (!code || state !== expectedState) {
        res.end("<h1>Invalid callback</h1>");
        server.close();
        reject(new Error("Missing code or state mismatch"));
        return;
      }
      res.end("<h1>Logged in</h1><p>You can close this tab and return to the terminal.</p>");
      server.close();
      resolve(code);
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1");
    setTimeout(() => {
      server.close();
      reject(new Error("Login timed out"));
    }, 180_000);
  });
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

async function exchangeCode(args: {
  clientId: string;
  clientSecret?: string;
  code: string;
  verifier: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: args.clientId,
    code_verifier: args.verifier,
  });
  if (args.clientSecret) body.set("client_secret", args.clientSecret);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token exchange failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return (await res.json()) as TokenResponse;
}

/** Refresh access token if it has <60s remaining. Returns the (possibly new) state. */
export async function refreshIfNeeded(state: OAuthState): Promise<OAuthState> {
  if (state.expiresAt - Date.now() > 60_000) return state;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: state.refreshToken,
    client_id: state.clientId,
  });
  if (state.clientSecret) body.set("client_secret", state.clientSecret);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Refresh failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const tok = (await res.json()) as TokenResponse;
  const next: OAuthState = {
    ...state,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token ?? state.refreshToken,
    expiresAt: Date.now() + tok.expires_in * 1000,
    scope: tok.scope ?? state.scope,
  };
  writeOAuthState(next);
  return next;
}

export function logout(): void {
  clearOAuthState();
}
