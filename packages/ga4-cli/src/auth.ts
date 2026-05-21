/**
 * GA4 auth — fetch-only. Replaces the previous `@google-analytics/{data,admin}`
 * + `google-auth-library` stack with direct REST + Web Crypto JWT signing so
 * the CLI runs in Node, Bun, and Cloudflare Workers.
 *
 * The public surface preserves Bin-Huang's original module: `setCredentialsPath`,
 * `setProfile`, `listProfiles`, `getProfilesDir`, `getDefaultCredentialsPath`,
 * `version` — so cli.ts and commands/profiles.ts don't need to change.
 *
 * What's new: `requireAccessToken`, `resolveAccessToken`, `authHeaders`,
 * `signServiceAccountJWT`. Commands now call these directly instead of
 * obtaining gRPC client instances.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadOAuthState, refreshIfNeeded } from "./oauth.ts";

export const version = "0.2.0";

const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const CONFIG_DIR = path.join(os.homedir(), ".config", "google-analytics-cli");
const DEFAULT_CREDENTIALS_PATH = path.join(CONFIG_DIR, "credentials.json");
const PROFILES_DIR = path.join(CONFIG_DIR, "profiles");

// ── per-invocation state (set from cli.ts preAction hook) ─────────────
let credentialsPath: string | undefined;
let profileName: string | undefined;

export function setCredentialsPath(p: string): void {
  credentialsPath = p;
}

const PROFILE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export function setProfile(name: string): void {
  profileName = name;
}

function validateProfileName(name: string): void {
  if (!PROFILE_NAME_PATTERN.test(name) || name === "." || name === "..") {
    throw new Error(
      `Invalid profile name "${name}". Profile names may only contain letters, digits, dots, underscores, and dashes.`,
    );
  }
}

export function getProfilePath(name: string): string {
  return path.join(PROFILES_DIR, `${name}.json`);
}

export function listProfiles(): { name: string; path: string }[] {
  if (!fs.existsSync(PROFILES_DIR)) return [];
  return fs
    .readdirSync(PROFILES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      name: f.slice(0, -".json".length),
      path: path.join(PROFILES_DIR, f),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getProfilesDir(): string {
  return PROFILES_DIR;
}

export function getDefaultCredentialsPath(): string {
  return DEFAULT_CREDENTIALS_PATH;
}

function resolveKeyFilename(): string | undefined {
  if (credentialsPath) return credentialsPath;
  if (profileName) {
    validateProfileName(profileName);
    const p = getProfilePath(profileName);
    if (!fs.existsSync(p)) {
      throw new Error(
        `Profile "${profileName}" not found at ${p}. Run \`ga4 profiles\` to list available profiles.`,
      );
    }
    return p;
  }
  if (
    !process.env.GOOGLE_APPLICATION_CREDENTIALS &&
    fs.existsSync(DEFAULT_CREDENTIALS_PATH)
  ) {
    return DEFAULT_CREDENTIALS_PATH;
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
  return undefined;
}

// ── token resolution ────────────────────────────────────────────────────

export interface ServiceAccountKey {
  type: "service_account";
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
}

/**
 * Resolve an access token. Precedence matches the previous Bin-Huang flow:
 *   1. `--credentials` flag (service-account JSON path)
 *   2. `--profile` flag (named SA under ~/.config/.../profiles/)
 *   3. `GA4_OAUTH_ACCESS_TOKEN` env (raw bearer — preferred for workers/CI;
 *       also accepts `GA4_ACCESS_TOKEN` for symmetry with FunnelEnvy's CLI)
 *   4. Stored OAuth tokens from `ga4 login` — auto-refresh if expired
 *   5. Default SA path: ~/.config/google-analytics-cli/credentials.json
 *   6. `GOOGLE_APPLICATION_CREDENTIALS` env (service-account JSON path)
 */
export async function resolveAccessToken(): Promise<string | undefined> {
  // Explicit credentials flag wins (--credentials or --profile)
  if (credentialsPath || profileName) {
    const keyFilename = resolveKeyFilename();
    if (keyFilename) return signFromKeyFile(keyFilename);
  }

  // Env-var raw bearer (no refresh attempted — short-lived tokens)
  const envToken = process.env.GA4_OAUTH_ACCESS_TOKEN ?? process.env.GA4_ACCESS_TOKEN;
  if (envToken) return envToken;

  // Stored OAuth from `ga4 login`
  const stored = loadOAuthState();
  if (stored) {
    const refreshed = await refreshIfNeeded(stored);
    return refreshed.accessToken;
  }

  // Default SA path or GOOGLE_APPLICATION_CREDENTIALS
  const keyFilename = resolveKeyFilename();
  if (keyFilename) return signFromKeyFile(keyFilename);

  return undefined;
}

export async function requireAccessToken(): Promise<string> {
  const token = await resolveAccessToken();
  if (!token) {
    throw new Error(
      "No GA4 credentials found. Provide one via:\n" +
        "  • --credentials <path-to-sa.json>\n" +
        "  • --profile <name>  (saved at ~/.config/google-analytics-cli/profiles/<name>.json)\n" +
        "  • GA4_OAUTH_ACCESS_TOKEN env (raw bearer)\n" +
        "  • GOOGLE_APPLICATION_CREDENTIALS env (SA JSON path)\n" +
        "  • ga4 login  (interactive OAuth)",
    );
  }
  return token;
}

export function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function signFromKeyFile(keyFilePath: string): Promise<string> {
  const raw = fs.readFileSync(keyFilePath, "utf8");
  const key = JSON.parse(raw) as ServiceAccountKey;
  if (key.type !== "service_account") {
    throw new Error(`${keyFilePath} is not a service-account key (type=${key.type})`);
  }
  return signServiceAccountJWT(key);
}

/**
 * Sign a JWT with the service-account private key using Web Crypto. Works
 * identically in Node, Bun, and Cloudflare Workers — no `node:crypto.createSign`,
 * no PEM-parsing assumptions beyond stripping headers + base64-decoding.
 */
export async function signServiceAccountJWT(key: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlJson({ alg: "RS256", typ: "JWT" });
  const claim = b64urlJson({
    iss: key.client_email,
    scope: GA4_SCOPE,
    aud: key.token_uri || TOKEN_URL,
    iat: now,
    exp: now + 3600,
  });
  const signingInput = `${header}.${claim}`;

  const privateKey = await importPkcs8PrivateKey(key.private_key);
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${b64urlBytes(new Uint8Array(signature))}`;

  const res = await fetch(key.token_uri || TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Service account token exchange failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function importPkcs8PrivateKey(pem: string): Promise<CryptoKey> {
  const stripped = pem
    .replace(/-----BEGIN [A-Z ]+-----/, "")
    .replace(/-----END [A-Z ]+-----/, "")
    .replace(/\s+/g, "");
  const bytes = base64ToBytes(stripped);
  return crypto.subtle.importKey(
    "pkcs8",
    bytes as unknown as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function b64urlJson(obj: unknown): string {
  return b64urlBytes(new TextEncoder().encode(JSON.stringify(obj)));
}

function b64urlBytes(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
