/**
 * Auth & token storage for the Oura CLI.
 *
 * - PAT mode: `OURA_ACCESS_TOKEN` env var, or saved in ~/.config/oura-cli/config.json.
 * - OAuth2 mode: `OURA_CLIENT_ID` + `OURA_CLIENT_SECRET`, tokens cached in
 *   ~/.config/oura-cli/tokens.json. Auto-refresh near expiry.
 *
 * `getToken()` is the only function the data commands need. It is fetch-only;
 * file I/O is skipped when `OURA_ACCESS_TOKEN` is set, which is the workerd
 * happy path.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const OAUTH_AUTHORIZE_URL = "https://cloud.ouraring.com/oauth/authorize";
export const OAUTH_TOKEN_URL = "https://api.ouraring.com/oauth/token";
export const OAUTH_SCOPES = "email personal daily heartrate workout tag session spo2";
export const CALLBACK_PORT = 8787;

export const CONFIG_DIR = join(homedir(), ".config", "oura-cli");
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");
export const TOKEN_FILE = join(CONFIG_DIR, "tokens.json");

export interface Config {
  auth_method: "pat" | "oauth2";
  access_token?: string;
  client_id?: string;
  client_secret?: string;
}

export interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

function readJson<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

export function loadConfig(): Config | null {
  return readJson<Config>(CONFIG_FILE);
}

export function saveConfig(config: Config): void {
  writeJson(CONFIG_FILE, config);
}

export function loadStoredTokens(): StoredTokens | null {
  return readJson<StoredTokens>(TOKEN_FILE);
}

export function saveTokens(tokens: StoredTokens): void {
  writeJson(TOKEN_FILE, tokens);
}

export function deleteTokens(): void {
  try {
    unlinkSync(TOKEN_FILE);
  } catch {
    /* not present */
  }
}

export function getOAuthCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.OURA_CLIENT_ID;
  const clientSecret = process.env.OURA_CLIENT_SECRET;
  if (clientId && clientSecret) return { clientId, clientSecret };

  const config = loadConfig();
  if (config?.auth_method === "oauth2" && config.client_id && config.client_secret) {
    return { clientId: config.client_id, clientSecret: config.client_secret };
  }

  throw new Error(
    "OAuth2 client credentials not found. Run 'oura setup' or set OURA_CLIENT_ID and OURA_CLIENT_SECRET.",
  );
}

export async function refreshAccessToken(refreshToken: string): Promise<StoredTokens> {
  const { clientId, clientSecret } = getOAuthCredentials();
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${body}. Run 'oura login' to re-authenticate.`);
  }
  const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  const stored: StoredTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshToken,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  saveTokens(stored);
  return stored;
}

export async function getToken(): Promise<string> {
  const envToken = process.env.OURA_ACCESS_TOKEN;
  if (envToken) return envToken;

  const config = loadConfig();
  if (config) {
    if (config.auth_method === "pat" && config.access_token) return config.access_token;
    if (config.auth_method === "oauth2") {
      const stored = loadStoredTokens();
      if (stored) {
        if (Date.now() >= stored.expires_at - 60_000) {
          const refreshed = await refreshAccessToken(stored.refresh_token);
          return refreshed.access_token;
        }
        return stored.access_token;
      }
      throw new Error("OAuth2 configured but not logged in. Run 'oura login'.");
    }
  }

  const stored = loadStoredTokens();
  if (stored) {
    if (Date.now() >= stored.expires_at - 60_000) {
      const refreshed = await refreshAccessToken(stored.refresh_token);
      return refreshed.access_token;
    }
    return stored.access_token;
  }

  throw new Error(
    "No Oura auth found. Set OURA_ACCESS_TOKEN env var or run 'oura setup'.",
  );
}
