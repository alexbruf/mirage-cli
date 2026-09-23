import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createInterface } from "node:readline";
import { type OAuthState, readConfig, writeConfig } from "./config.ts";

/**
 * OAuth 2.1 + PKCE against a Markup deployment, which is its own authorization
 * server (the Worker's `/authorize` reuses the magic-link login).
 *
 * The CLI has no registration step: its `client_id` is the URL of a Client ID
 * Metadata Document the deployment serves (`/cli/oauth-client.json`), so the
 * client never expires the way a dynamically registered one can. Refresh tokens
 * do not expire either (they rotate on every use), so one `markup login` lasts
 * until `markup logout`.
 */

export const SCOPE = "mcp";
export const DEFAULT_PORT = 53683;

export const clientIdFor = (host: string): string => `${host}/cli/oauth-client.json`;

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

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

async function tokenRequest(issuer: string, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${issuer}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`token request failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return (await res.json()) as TokenResponse;
}

export interface LoginOpts {
  host: string;
  clientId?: string;
  port?: number;
  /** Print the URL but do not try to open a browser (SSH sessions, CI). */
  noBrowser?: boolean;
}

export async function login(opts: LoginOpts): Promise<OAuthState> {
  const issuer = opts.host;
  const clientId = opts.clientId ?? clientIdFor(issuer);
  const port = opts.port ?? DEFAULT_PORT;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const state = b64url(randomBytes(16));
  const { verifier, challenge } = pkce();

  const authUrl = new URL(`${issuer}/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", SCOPE);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("resource", `${issuer}/mcp`);

  const loopback = waitForCode(port, state);
  console.error("Opening your browser to sign in to Markup...");
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

  const tok = await tokenRequest(issuer, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
    resource: `${issuer}/mcp`,
  });
  if (!tok.refresh_token) throw new Error("the server did not issue a refresh token");
  const oauth: OAuthState = {
    issuer,
    clientId,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: Date.now() + tok.expires_in * 1000,
    scope: tok.scope ?? SCOPE,
  };
  writeConfig({ ...readConfig(), host: issuer, oauth });
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
  if (!code) throw new Error("that URL has no ?code=; paste the address the browser ended on after Allow");
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
        res.end(page("Login failed", "Run <code>markup login</code> again."));
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
 * Swap the refresh token for a new pair and save it. The server rotates the
 * refresh token on every use, so the saved one must be replaced each time.
 */
export async function refresh(state: OAuthState): Promise<OAuthState> {
  const tok = await tokenRequest(state.issuer, {
    grant_type: "refresh_token",
    refresh_token: state.refreshToken,
    client_id: state.clientId,
  });
  const next: OAuthState = {
    ...state,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token ?? state.refreshToken,
    expiresAt: Date.now() + tok.expires_in * 1000,
    scope: tok.scope ?? state.scope,
  };
  writeConfig({ ...readConfig(), oauth: next });
  return next;
}

/** Revoke the grant server-side (RFC 7009), then forget it locally. */
export async function logout(): Promise<{ revoked: boolean }> {
  const cfg = readConfig();
  let revoked = false;
  if (cfg.oauth) {
    try {
      const res = await fetch(`${cfg.oauth.issuer}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: cfg.oauth.refreshToken,
          token_type_hint: "refresh_token",
          client_id: cfg.oauth.clientId,
        }).toString(),
      });
      revoked = res.ok;
    } catch {
      // Offline: still forget the tokens locally.
    }
  }
  const { oauth: _dropped, ...rest } = cfg;
  writeConfig(rest);
  return { revoked };
}
