import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readConfig, writeConfig, type CLIConfig, type OAuthState } from "./config.ts";

const STAGING_CLERK = {
  issuer: "https://causal-seal-84.clerk.accounts.dev",
  clientId: "FHFbsCNPcQoc9cJ6",
};
const PROD_CLERK = {
  issuer: "https://clerk.reddit.viewengine.ai",
  clientId: "Sxm9babDwnJT4LkL",
};

function defaultsForHost(host: string | undefined): { issuer: string; clientId: string } {
  if (host && /reddit\.viewengine\.ai/i.test(host)) return PROD_CLERK;
  return STAGING_CLERK;
}

const DEFAULT_SCOPES = "openid profile email";

const b64url = (buf: Buffer): string =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function pkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  import("node:child_process")
    .then(({ spawn }) => {
      spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
    })
    .catch(() => {});
}

interface LoginOpts {
  issuer?: string;
  clientId?: string;
  scopes?: string;
  port?: number;
}

export async function login(opts: LoginOpts = {}): Promise<OAuthState> {
  const hostDefaults = defaultsForHost(readConfig().host);
  const envIssuer = process.env.REDDIT_CLI_OAUTH_ISSUER;
  const envClientId = process.env.REDDIT_CLI_OAUTH_CLIENT_ID;
  const issuer = (opts.issuer ?? envIssuer ?? hostDefaults.issuer).replace(/\/$/, "");
  const clientId = opts.clientId ?? envClientId ?? hostDefaults.clientId;
  const scopes = opts.scopes ?? DEFAULT_SCOPES;
  if (!clientId) {
    throw new Error(
      "No OAuth client_id configured. Set REDDIT_CLI_OAUTH_CLIENT_ID or pass --client-id.",
    );
  }
  const port = opts.port ?? 53682;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const state = b64url(randomBytes(16));
  const { verifier, challenge } = pkce();

  const authUrl = new URL(`${issuer}/oauth/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  console.log(`Opening browser to log in...`);
  console.log(`If it doesn't open, visit: ${authUrl.toString()}`);
  openBrowser(authUrl.toString());

  const code = await waitForCode(port, state);
  const tokens = await exchangeCode({ issuer, clientId, code, verifier, redirectUri });
  const oauth: OAuthState = {
    issuer,
    clientId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    scope: tokens.scope ?? scopes,
  };
  const cfg: CLIConfig = { ...readConfig(), oauth };
  writeConfig(cfg);
  return oauth;
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
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

async function exchangeCode(args: {
  issuer: string;
  clientId: string;
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
  const res = await fetch(`${args.issuer}/oauth/token`, {
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

export async function refresh(state: OAuthState): Promise<OAuthState> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: state.refreshToken,
    client_id: state.clientId,
  });
  const res = await fetch(`${state.issuer}/oauth/token`, {
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
  const cfg = readConfig();
  writeConfig({ ...cfg, oauth: next });
  return next;
}

export function logout(): void {
  const cfg = readConfig();
  delete cfg.oauth;
  writeConfig(cfg);
}
