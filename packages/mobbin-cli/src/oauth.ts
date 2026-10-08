import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createInterface } from "node:readline";
import { type OAuthState, readConfig, type Registration, resolveMcpUrl, writeConfig } from "./config.ts";

/**
 * OAuth 2.1 + PKCE against Mobbin's authorization server, found by MCP
 * discovery rather than hardcoded: the MCP endpoint's protected-resource
 * metadata names the issuer (a Supabase Auth project today), and the issuer's
 * metadata names the authorize, token and registration endpoints.
 *
 * Unlike Markup there is no client metadata document, so the CLI registers a
 * public client through Dynamic Client Registration (RFC 7591) once and keeps
 * its client_id for later sign-ins. Access tokens last an hour. Refresh tokens
 * rotate on every use (the old one keeps working for a while, measured
 * 2026-10-08, but only the newest is saved), so one `mobbin login` lasts until
 * `mobbin logout` or until access is revoked in Mobbin's settings.
 */

export const SCOPE = "openid";
export const DEFAULT_PORT = 53684;
const CLIENT_NAME = "Mobbin CLI (mirage-cli)";

const b64url = (buf: Buffer): string => buf.toString("base64url");

export function pkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  import("node:child_process")
    .then(({ spawn }) => {
      spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
    })
    .catch(() => {});
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

export interface AuthServer {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
}

/**
 * Resource metadata → issuer → issuer metadata. Tries the issuer-suffixed
 * well-known path (what Supabase serves) before the RFC 8414 host-inserted one.
 */
export async function discover(mcpUrl: string = resolveMcpUrl()): Promise<AuthServer> {
  const mcp = new URL(mcpUrl);
  const resource = await getJson<{ authorization_servers?: string[] }>(
    `${mcp.origin}/.well-known/oauth-protected-resource${mcp.pathname}`,
  );
  const issuer = resource.authorization_servers?.[0]?.replace(/\/$/, "");
  if (!issuer) throw new Error("Mobbin's resource metadata names no authorization server");
  const iss = new URL(issuer);
  const candidates = [
    `${issuer}/.well-known/oauth-authorization-server`,
    `${iss.origin}/.well-known/oauth-authorization-server${iss.pathname}`,
  ];
  for (const url of candidates) {
    try {
      const meta = await getJson<AuthServer>(url);
      if (meta.authorization_endpoint && meta.token_endpoint) return { ...meta, issuer: meta.issuer ?? issuer };
    } catch {
      // Try the next location.
    }
  }
  throw new Error(`could not read authorization server metadata for ${issuer}`);
}

/** Reuse the saved client when it was registered for this issuer and redirect URI. */
export async function ensureClient(as: AuthServer, redirectUri: string, clientIdOverride?: string): Promise<string> {
  if (clientIdOverride) return clientIdOverride;
  const saved = readConfig().registration;
  if (saved && saved.issuer === as.issuer && saved.redirectUri === redirectUri) return saved.clientId;
  if (!as.registration_endpoint) throw new Error("Mobbin's authorization server offers no client registration; pass --client-id");
  const res = await fetch(as.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`client registration failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const { client_id } = (await res.json()) as { client_id?: string };
  if (!client_id) throw new Error("client registration returned no client_id");
  const registration: Registration = { issuer: as.issuer, clientId: client_id, redirectUri };
  writeConfig({ ...readConfig(), registration });
  return client_id;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

async function tokenRequest(tokenEndpoint: string, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    // Error bodies are OAuth error codes, never tokens; keep a short excerpt.
    const text = await res.text().catch(() => "");
    throw new Error(`token request failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return (await res.json()) as TokenResponse;
}

export interface LoginOpts {
  clientId?: string;
  port?: number;
  /** Print the URL but do not try to open a browser (SSH sessions, CI). */
  noBrowser?: boolean;
}

export async function login(opts: LoginOpts = {}): Promise<OAuthState> {
  const mcpUrl = resolveMcpUrl();
  const as = await discover(mcpUrl);
  const port = opts.port ?? DEFAULT_PORT;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const clientId = await ensureClient(as, redirectUri, opts.clientId);
  const state = b64url(randomBytes(16));
  const { verifier, challenge } = pkce();

  const authUrl = new URL(as.authorization_endpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", SCOPE);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("resource", mcpUrl);

  const loopback = waitForCode(port, state);
  console.error("Opening your browser to sign in to Mobbin (Pro, Team or Enterprise plan)...");
  console.error(`If it does not open, visit:\n  ${authUrl.toString()}`);
  console.error(
    "\nIf your browser is on another machine, it will end on a page that does not load.\n" +
      "Paste that page's full address (http://127.0.0.1:.../callback?code=...) here and press Enter:",
  );
  if (!opts.noBrowser) openBrowser(authUrl.toString());
  const pasted = waitForPastedCallback(state);
  let code: string;
  try {
    code = await Promise.race([loopback.code, pasted.code]);
  } finally {
    loopback.stop();
    pasted.stop();
  }

  const tok = await tokenRequest(as.token_endpoint, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });
  if (!tok.refresh_token) throw new Error("Mobbin did not issue a refresh token");
  const oauth: OAuthState = {
    issuer: as.issuer,
    tokenEndpoint: as.token_endpoint,
    clientId,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: Date.now() + tok.expires_in * 1000,
  };
  writeConfig({ ...readConfig(), oauth });
  return oauth;
}

interface Waiter {
  code: Promise<string>;
  stop: () => void;
}

/**
 * The code from a callback URL, or an error saying why not. Shared by the
 * loopback listener and the paste fallback so both check `state` the same way.
 */
export function codeFromCallback(input: string, expectedState: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("that is not a URL; paste the whole address from the browser's address bar");
  }
  const err = url.searchParams.get("error");
  if (err) throw new Error(`login failed: ${err}`);
  const code = url.searchParams.get("code");
  if (!code) throw new Error("that URL has no ?code=; paste the address the browser ended on after Continue");
  if (url.searchParams.get("state") !== expectedState) {
    throw new Error("that URL belongs to a different login attempt (state mismatch)");
  }
  return code;
}

function waitForCode(port: number, expectedState: string): Waiter {
  let stop = () => {};
  const code = new Promise<string>((resolve, reject) => {
    const page = (title: string, body: string) =>
      `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:15px system-ui;padding:40px"><h1>${title}</h1><p>${body}</p>`;
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      try {
        const got = codeFromCallback(url.toString(), expectedState);
        res.end(page("Signed in", "You can close this tab and return to the terminal."));
        finish(() => resolve(got));
      } catch (e) {
        res.end(page("Login failed", "Run <code>mobbin login</code> again."));
        finish(() => reject(e));
      }
    });
    const timer = setTimeout(() => finish(() => reject(new Error("login timed out after 5 minutes"))), 300_000);
    function finish(settle: () => void) {
      clearTimeout(timer);
      server.close(() => {});
      settle();
    }
    stop = () => finish(() => {});
    // A busy port only disables this channel when pasting can stand in for it.
    server.once("error", (e: Error) => {
      clearTimeout(timer);
      if (process.stdin.isTTY) console.error(`(port ${port} is busy, so paste the URL instead)`);
      else reject(new Error(`cannot listen on 127.0.0.1:${port} (${e.message}); try --port`));
    });
    server.listen(port, "127.0.0.1");
  });
  return { code, stop };
}

/**
 * The fallback for a browser that cannot reach this machine's loopback (SSH,
 * a remote dev box): the person pastes the URL the browser ended on. Only
 * listens on an interactive terminal, so a piped or backgrounded run is not
 * held open waiting for input that will never come.
 */
function waitForPastedCallback(expectedState: string): Waiter {
  if (!process.stdin.isTTY) return { code: new Promise<string>(() => {}), stop: () => {} };
  const rl = createInterface({ input: process.stdin, terminal: false });
  const code = new Promise<string>((resolve) => {
    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        resolve(codeFromCallback(line, expectedState));
      } catch (e) {
        console.error(`${(e as Error).message}. Try again:`);
      }
    });
  });
  return { code, stop: () => rl.close() };
}

/**
 * Swap the refresh token for a new pair and save it. Mobbin rotates the
 * refresh token on every use, so the saved one is replaced each time.
 */
export async function refresh(state: OAuthState): Promise<OAuthState> {
  const tok = await tokenRequest(state.tokenEndpoint, {
    grant_type: "refresh_token",
    refresh_token: state.refreshToken,
    client_id: state.clientId,
  });
  const next: OAuthState = {
    ...state,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token ?? state.refreshToken,
    expiresAt: Date.now() + tok.expires_in * 1000,
  };
  writeConfig({ ...readConfig(), oauth: next });
  return next;
}

/**
 * Forget the session locally. Mobbin's authorization server advertises no
 * revocation endpoint, so access is withdrawn in Mobbin's own settings
 * (https://docs.mobbin.com/mcp/disconnect).
 */
export function logout(): void {
  const { oauth: _dropped, ...rest } = readConfig();
  writeConfig(rest);
}
