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
  /**
   * Active org override. When set, the client sends it as `X-Active-Org-Id`
   * on every request so the org-scoped V1 API resolves the right tenant.
   * Persisted via `radar orgs use <id>`; overridable per-call with `--org`
   * or the `RADAR_ACTIVE_ORG_ID` env var.
   */
  activeOrgId?: string;
}

const CONFIG_DIR = join(homedir(), ".config", "radar");
const SESSION_PATH = join(CONFIG_DIR, "session.json");

const DEFAULT_BASE_URL = "https://radar.viewengine.ai";

export function getDefaultBaseUrl(): string {
  return process.env.RADAR_API_BASE_URL ?? DEFAULT_BASE_URL;
}

/** Read the persisted on-disk session (ignores env). Null if none. */
export function loadFileSession(): Session | null {
  if (!existsSync(SESSION_PATH)) return null;
  try {
    return JSON.parse(readFileSync(SESSION_PATH, "utf-8")) as Session;
  } catch {
    return null;
  }
}

/**
 * Load session from env or disk. Env vars take precedence (CI/evals).
 * `RADAR_ACTIVE_ORG_ID` is layered on top of whichever source wins.
 */
export function loadSession(): Session | null {
  const envOrg = process.env.RADAR_ACTIVE_ORG_ID;
  const envKey = process.env.RADAR_API_KEY;
  if (envKey) {
    return {
      apiKey: envKey,
      baseUrl: getDefaultBaseUrl(),
      savedAt: new Date().toISOString(),
      ...(envOrg ? { activeOrgId: envOrg } : {}),
    };
  }
  const envOAuth = process.env.RADAR_OAUTH_ACCESS_TOKEN;
  if (envOAuth) {
    return {
      accessToken: envOAuth,
      baseUrl: getDefaultBaseUrl(),
      savedAt: new Date().toISOString(),
      ...(envOrg ? { activeOrgId: envOrg } : {}),
    };
  }
  const fileSession = loadFileSession();
  if (!fileSession) return null;
  // Env override still wins for the active org even when auth came from disk.
  if (envOrg) fileSession.activeOrgId = envOrg;
  return fileSession;
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

/**
 * Persist (or clear) the active org on the on-disk session. Requires a
 * logged-in file session — env-only auth (CI / worker) can't persist, and
 * should use `--org` or `RADAR_ACTIVE_ORG_ID` instead.
 */
export function setActiveOrg(orgId: string | null): void {
  const s = loadFileSession();
  if (!s) {
    console.error(
      "No saved session to update. Run `radar login` first, or set an org with --org / RADAR_ACTIVE_ORG_ID.",
    );
    process.exit(1);
  }
  if (orgId) s.activeOrgId = orgId;
  else delete s.activeOrgId;
  s.savedAt = new Date().toISOString();
  saveSession(s);
}

export const SESSION_PATH_FOR_DISPLAY = SESSION_PATH;
