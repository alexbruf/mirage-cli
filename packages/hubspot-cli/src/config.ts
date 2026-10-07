import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ApiError, type TokenProvider } from "./client.ts";

/**
 * Token resolution. Every HubSpot credential type collapses to a single
 * `Authorization: Bearer <token>` at the API layer; the only difference is how
 * we obtain that token. Resolution precedence (stateless per invocation, so
 * cached programs in long-lived hosts stay correct):
 *
 *   1. --token                          → used directly.
 *   2. HUBSPOT_ACCOUNTS                 → a JSON map of account name to key,
 *      selected by --account <name> (or the only entry). Lets one host hold
 *      keys for several portals. A `pat-…` key is used directly; any other
 *      value is exchanged as a personal access key (falling back to direct).
 *   3. HUBSPOT_ACCESS_TOKEN             → used directly (private app token or
 *      any OAuth/access token). No exchange, no disk — the worker-friendly path.
 *   4. HUBSPOT_PERSONAL_ACCESS_KEY (+ HUBSPOT_ACCOUNT_ID) → exchanged for a
 *      short-lived access token, cached in-process until expiry.
 *   5. ~/.hscli/config.yml account (selected by --account <name|id> or the
 *      config's default) → that account's personal access key, exchanged.
 *      This reuses your existing `hs account auth` login — no new auth to learn.
 *
 * The PAK → access-token exchange is the same call `@hubspot/local-dev-lib`
 * (and therefore the `hs` CLI) performs:
 *   POST {base}/localdevauth/v1/auth/refresh?portalId=<id>
 *   body: { "encodedOAuthRefreshToken": "<personal-access-key>" }
 *   → { oauthAccessToken, expiresAtMillis, hubId }
 */

const DEFAULT_BASE_URL = "https://api.hubapi.com";

/** `~/.hscli/config.yml` — the global config the `hs` CLI writes. */
const HS_CONFIG_PATH = join(homedir(), ".hscli", "config.yml");

export function getDefaultBaseUrl(): string {
  return process.env.HUBSPOT_API_BASE_URL ?? DEFAULT_BASE_URL;
}

export interface CredentialFlags {
  /** Direct access token (private app / OAuth). */
  token?: string;
  /** Account name from HUBSPOT_ACCOUNTS, or name/portal id from ~/.hscli/config.yml. */
  account?: string;
  baseUrl?: string;
}

export interface ResolvedAuth {
  tokenProvider: TokenProvider;
  source: "flag-token" | "env-accounts" | "env-token" | "env-pak" | "config-account";
  /** Selected account name/id when resolved from HUBSPOT_ACCOUNTS or config (display only). */
  account?: string;
  portalId?: string;
}

// ── PAK exchange + in-process token cache ──

interface CachedToken {
  token: string;
  /** Epoch ms after which the token should be refreshed. */
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

interface AccessTokenResponse {
  oauthAccessToken: string;
  expiresAtMillis: number;
  hubId?: number;
}

/**
 * Exchange a personal access key for a short-lived access token, caching it in
 * process. Refreshed 60s before expiry so a long `--all` walk never 401s
 * mid-stream.
 */
export async function exchangePersonalAccessKey(
  personalAccessKey: string,
  portalId?: string,
  baseUrl: string = getDefaultBaseUrl(),
): Promise<string> {
  const cacheKey = `${baseUrl}|${portalId ?? ""}|${personalAccessKey}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const url = new URL(`${baseUrl.replace(/\/$/, "")}/localdevauth/v1/auth/refresh`);
  if (portalId) url.searchParams.set("portalId", portalId);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ encodedOAuthRefreshToken: personalAccessKey }),
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text || res.statusText;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? message;
    } catch {
      /* keep raw text */
    }
    throw new ApiError(
      res.status,
      `personal access key exchange failed: ${message}`,
      res.status === 401 ? "the personal access key is invalid or revoked" : undefined,
    );
  }
  const data = (await res.json()) as AccessTokenResponse;
  tokenCache.set(cacheKey, {
    token: data.oauthAccessToken,
    expiresAt: data.expiresAtMillis - 60_000,
  });
  return data.oauthAccessToken;
}

// ── HUBSPOT_ACCOUNTS ──

/**
 * Parse HUBSPOT_ACCOUNTS: a JSON object mapping account name to access token,
 * e.g. `{"viewengine":"pat-na1-…","acme":"pat-na1-…"}`. Null when unset. Throws
 * on malformed input without echoing the value, since it holds secrets.
 */
export function loadEnvAccounts(): Map<string, string> | null {
  const raw = process.env.HUBSPOT_ACCOUNTS;
  if (raw === undefined || raw.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      'HUBSPOT_ACCOUNTS is not valid JSON. Expected an object of account name to access token, e.g. {"acme":"pat-na1-..."}.',
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("HUBSPOT_ACCOUNTS must be a JSON object of account name to access token.");
  }
  const accounts = new Map<string, string>();
  for (const [name, token] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof token !== "string" || token === "") {
      throw new Error(`HUBSPOT_ACCOUNTS entry "${name}" must be a non-empty access token string.`);
    }
    accounts.set(name, token);
  }
  if (accounts.size === 0) throw new Error("HUBSPOT_ACCOUNTS has no accounts.");
  return accounts;
}

/** Values the exchange refused, so later calls skip straight to the direct path. */
const notPersonalAccessKeys = new Set<string>();

/**
 * Bearer for one HUBSPOT_ACCOUNTS value. A private app or service key
 * (`pat-…`) is used directly. Anything else is first treated as a personal
 * access key and exchanged; if the exchange refuses it (an OAuth access token,
 * say), the value is used directly after all.
 */
export async function accountTokenProvider(
  value: string,
  baseUrl: string = getDefaultBaseUrl(),
): Promise<string> {
  if (value.startsWith("pat-") || notPersonalAccessKeys.has(value)) return value;
  try {
    return await exchangePersonalAccessKey(value, undefined, baseUrl);
  } catch (err) {
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      notPersonalAccessKeys.add(value);
      return value;
    }
    throw err;
  }
}

// ── ~/.hscli/config.yml ──

export interface HsAccount {
  name?: string;
  accountId?: number;
  personalAccessKey?: string;
}

export interface HsConfig {
  defaultAccount?: string | number;
  accounts: HsAccount[];
}

/** Read ~/.hscli/config.yml (ignores env). Null if missing/unreadable. */
export async function loadHsConfig(): Promise<HsConfig | null> {
  if (!existsSync(HS_CONFIG_PATH)) return null;
  try {
    // Lazy so the env-token / env-PAK paths never need the YAML parser (keeps
    // workerd happy — it only loads when actually reading the on-disk login).
    const { parse } = await import("yaml");
    const parsed = parse(readFileSync(HS_CONFIG_PATH, "utf-8")) as
      | { defaultPortal?: string | number; defaultAccount?: string | number; portals?: HsAccount[]; accounts?: HsAccount[] }
      | null;
    if (!parsed) return null;
    // Field names drifted across hs versions (portals→accounts, defaultPortal→
    // defaultAccount); accept either.
    const accounts = parsed.accounts ?? parsed.portals ?? [];
    if (!Array.isArray(accounts)) return null;
    return { defaultAccount: parsed.defaultAccount ?? parsed.defaultPortal, accounts };
  } catch {
    return null;
  }
}

/** Find an account in the hs config by name or numeric id; default if unset. */
export function selectHsAccount(config: HsConfig, selector?: string | number): HsAccount | null {
  const sel = selector ?? config.defaultAccount;
  if (sel === undefined) {
    return config.accounts.length === 1 ? (config.accounts[0] ?? null) : null;
  }
  const s = String(sel);
  return (
    config.accounts.find((a) => a.name === s || String(a.accountId) === s) ?? null
  );
}

// ── top-level resolver ──

/**
 * Resolve a bearer-token provider for one invocation. Throws with an
 * actionable message when no credential is available — the caller surfaces it
 * as structured JSON so an LLM driver can recover.
 */
export async function resolveAuth(flags: CredentialFlags = {}): Promise<ResolvedAuth> {
  const baseUrl = flags.baseUrl ?? getDefaultBaseUrl();

  // 1. explicit token flag
  const flagToken = flags.token;
  if (flagToken) return { tokenProvider: async () => flagToken, source: "flag-token" };

  // 2. named access tokens from env
  const envAccounts = loadEnvAccounts();
  if (envAccounts) {
    const names = [...envAccounts.keys()];
    const name = flags.account ?? (names.length === 1 ? names[0] : undefined);
    if (name === undefined) {
      throw new Error(`Several HubSpot accounts are configured. Pick one with --account <name>. Accounts: ${names.join(", ")}`);
    }
    const token = envAccounts.get(name);
    if (!token) {
      throw new Error(`Unknown HubSpot account "${name}". Accounts: ${names.join(", ")}`);
    }
    return {
      tokenProvider: () => accountTokenProvider(token, baseUrl),
      source: "env-accounts",
      account: name,
    };
  }

  // 3. direct access token from env
  const envToken = process.env.HUBSPOT_ACCESS_TOKEN;
  if (envToken) return { tokenProvider: async () => envToken, source: "env-token" };

  // 4. personal access key from env
  const envPak = process.env.HUBSPOT_PERSONAL_ACCESS_KEY;
  if (envPak) {
    const portalId = flags.account ?? process.env.HUBSPOT_ACCOUNT_ID;
    return {
      tokenProvider: () => exchangePersonalAccessKey(envPak, portalId, baseUrl),
      source: "env-pak",
      ...(portalId ? { portalId } : {}),
    };
  }

  // 5. reuse the existing `hs` login from ~/.hscli/config.yml
  const config = await loadHsConfig();
  if (config && config.accounts.length > 0) {
    const account = selectHsAccount(config, flags.account);
    if (!account) {
      const names = config.accounts.map((a) => a.name ?? a.accountId).join(", ");
      throw new Error(
        `Multiple HubSpot accounts in ~/.hscli/config.yml — pick one with --account <name|id>. ` +
          `Accounts: ${names}`,
      );
    }
    if (!account.personalAccessKey) {
      throw new Error(
        `Account "${account.name ?? account.accountId}" has no personalAccessKey in ~/.hscli/config.yml ` +
          `(was it authed with OAuth?). Set HUBSPOT_ACCESS_TOKEN instead.`,
      );
    }
    const portalId = account.accountId ? String(account.accountId) : undefined;
    const pak = account.personalAccessKey;
    return {
      tokenProvider: () => exchangePersonalAccessKey(pak, portalId, baseUrl),
      source: "config-account",
      account: account.name ?? (portalId ? `portal ${portalId}` : undefined),
      ...(portalId ? { portalId } : {}),
    };
  }

  throw new Error(
    "No HubSpot credentials. Set HUBSPOT_ACCESS_TOKEN (private app token), " +
      "HUBSPOT_ACCOUNTS (JSON map of account name to token), HUBSPOT_PERSONAL_ACCESS_KEY, or run `hs account auth` to populate ~/.hscli/config.yml.",
  );
}

export const HS_CONFIG_PATH_FOR_DISPLAY = HS_CONFIG_PATH;
