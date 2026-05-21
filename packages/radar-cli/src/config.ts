import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Session {
  baseUrl: string;
  savedAt: string;
  /** API-key auth (Clerk machine key `sk_...`) */
  apiKey?: string;
  /** OAuth auth (Clerk OAuth provider, PKCE) */
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenEndpoint?: string;
  clientId?: string;
}

const CONFIG_DIR = join(homedir(), ".config", "radar");
const SESSION_PATH = join(CONFIG_DIR, "session.json");

const DEFAULT_BASE_URL = "https://radar.viewengine.ai";

export function getDefaultBaseUrl(): string {
  return process.env.RADAR_API_BASE_URL ?? DEFAULT_BASE_URL;
}

/**
 * Load session from env or disk. Env vars take precedence (CI/evals).
 */
export function loadSession(): Session | null {
  const envKey = process.env.RADAR_API_KEY;
  if (envKey) {
    return {
      apiKey: envKey,
      baseUrl: getDefaultBaseUrl(),
      savedAt: new Date().toISOString(),
    };
  }
  const envOAuth = process.env.RADAR_OAUTH_ACCESS_TOKEN;
  if (envOAuth) {
    return {
      accessToken: envOAuth,
      baseUrl: getDefaultBaseUrl(),
      savedAt: new Date().toISOString(),
    };
  }
  if (!existsSync(SESSION_PATH)) return null;
  try {
    return JSON.parse(readFileSync(SESSION_PATH, "utf-8")) as Session;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2), { mode: 0o600 });
  chmodSync(SESSION_PATH, 0o600);
}

export function clearSession(): void {
  if (existsSync(SESSION_PATH)) unlinkSync(SESSION_PATH);
}

export function requireSession(): Session {
  const s = loadSession();
  if (!s) {
    console.error("Not logged in. Run: radar login  (or: radar login --api-key <key>)");
    process.exit(1);
  }
  return s;
}

export const SESSION_PATH_FOR_DISPLAY = SESSION_PATH;
