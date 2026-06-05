import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Credential model: a *profile* is one CallRail API key (keys are user-scoped;
 * in practice one key per agency/account). Profiles come from two places and
 * are merged per invocation — env wins on name collision:
 *
 *  - disk:  ~/.config/callrail/config.json  (managed via `callrail auth ...`)
 *  - env:   CALLRAIL_API_KEYS — either compact `name:key,name2:key2` or a JSON
 *           object `{"name":{"apiKey":"...","accountId":"ACC..."}}`
 *
 * Resolution precedence (stateless, per call — safe for cached programs in
 * long-lived hosts like workers):
 *
 *   api key:  --api-key > CALLRAIL_API_KEY > profiles[--profile >
 *             CALLRAIL_PROFILE > disk activeProfile] > sole profile
 *   account:  --account > CALLRAIL_ACCOUNT_ID > profile.accountId
 *             (callers may auto-probe /v3/a.json when still unset)
 */

export interface Profile {
  apiKey: string;
  /** Pinned CallRail account id (ACC...). Optional — auto-probed when the key sees exactly one. */
  accountId?: string;
  addedAt?: string;
  /** Where the profile came from. Env profiles are read-only. */
  source?: "file" | "env";
}

export interface FileConfig {
  activeProfile?: string;
  profiles: Record<string, Profile>;
}

export interface ResolvedCredentials {
  apiKey: string;
  accountId?: string;
  /** Profile name when the key came from a profile (undefined for --api-key / CALLRAIL_API_KEY). */
  profile?: string;
  source: "flag" | "env" | "env-profile" | "file-profile";
}

export interface CredentialFlags {
  apiKey?: string;
  account?: string;
  profile?: string;
}

const CONFIG_DIR = join(homedir(), ".config", "callrail");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

const DEFAULT_BASE_URL = "https://api.callrail.com/v3";

export function getDefaultBaseUrl(): string {
  return process.env.CALLRAIL_API_BASE_URL ?? DEFAULT_BASE_URL;
}

/** Read the on-disk config (ignores env). Null if missing/unreadable. */
export function loadFileConfig(): FileConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as FileConfig;
    if (!parsed.profiles || typeof parsed.profiles !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveFileConfig(config: FileConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
  chmodSync(CONFIG_PATH, 0o600);
}

/**
 * Parse CALLRAIL_API_KEYS into a profiles map. Two shapes, sniffed by first
 * char: JSON object (same shape as the disk file's `profiles`) or compact
 * `name:key,name2:key2` pairs (CallRail keys are alphanumeric, so `:` and `,`
 * are safe delimiters). Throws on malformed input — a silently-ignored
 * credential env var is worse than an error.
 */
export function parseEnvProfiles(raw: string): Record<string, Profile> {
  const trimmed = raw.trim();
  if (trimmed === "") return {};
  const profiles: Record<string, Profile> = {};
  if (trimmed.startsWith("{")) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`CALLRAIL_API_KEYS is not valid JSON: ${(err as Error).message}`);
    }
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        profiles[name] = { apiKey: value, source: "env" };
        continue;
      }
      const obj = value as { apiKey?: string; accountId?: string };
      if (!obj || typeof obj.apiKey !== "string" || obj.apiKey === "") {
        throw new Error(`CALLRAIL_API_KEYS profile "${name}" is missing "apiKey"`);
      }
      profiles[name] = {
        apiKey: obj.apiKey,
        ...(obj.accountId ? { accountId: obj.accountId } : {}),
        source: "env",
      };
    }
    return profiles;
  }
  for (const pair of trimmed.split(",")) {
    const entry = pair.trim();
    if (entry === "") continue;
    const sep = entry.indexOf(":");
    if (sep <= 0 || sep === entry.length - 1) {
      throw new Error(
        `CALLRAIL_API_KEYS entry "${entry}" is not "name:key" (or pass a JSON object)`,
      );
    }
    profiles[entry.slice(0, sep).trim()] = { apiKey: entry.slice(sep + 1).trim(), source: "env" };
  }
  return profiles;
}

/** Disk profiles overlaid by env profiles (env wins; disk absent in workers is fine). */
export function mergedProfiles(): Record<string, Profile> {
  const file = loadFileConfig();
  const out: Record<string, Profile> = {};
  for (const [name, p] of Object.entries(file?.profiles ?? {})) {
    out[name] = { ...p, source: "file" };
  }
  const rawEnv = process.env.CALLRAIL_API_KEYS;
  if (rawEnv) Object.assign(out, parseEnvProfiles(rawEnv));
  return out;
}

/**
 * Resolve credentials for one invocation. Throws with an actionable message
 * (including available profile names) when ambiguous or missing — the caller
 * surfaces it as a structured error so an LLM driver can recover.
 */
export function resolveCredentials(flags: CredentialFlags = {}): ResolvedCredentials {
  const account = flags.account ?? process.env.CALLRAIL_ACCOUNT_ID;

  if (flags.apiKey) {
    return { apiKey: flags.apiKey, ...(account ? { accountId: account } : {}), source: "flag" };
  }

  const envKey = process.env.CALLRAIL_API_KEY;
  if (envKey) {
    if (process.env.CALLRAIL_API_KEYS) {
      process.stderr.write(
        "warning: both CALLRAIL_API_KEY and CALLRAIL_API_KEYS are set — using CALLRAIL_API_KEY\n",
      );
    }
    return { apiKey: envKey, ...(account ? { accountId: account } : {}), source: "env" };
  }

  const profiles = mergedProfiles();
  const names = Object.keys(profiles);
  if (names.length === 0) {
    throw new Error(
      "No CallRail credentials. Set CALLRAIL_API_KEY (or CALLRAIL_API_KEYS=\"name:key,...\"), " +
        "or run: callrail auth add <name> --api-key <key>",
    );
  }

  let name = flags.profile ?? process.env.CALLRAIL_PROFILE ?? loadFileConfig()?.activeProfile;
  if (!name && names.length === 1) name = names[0];
  if (!name) {
    throw new Error(
      `Multiple profiles defined, pick one with --profile <name> (or CALLRAIL_PROFILE, ` +
        `or \`callrail auth use <name>\`). Profiles: ${names.join(", ")}`,
    );
  }
  const profile = profiles[name];
  if (!profile) {
    throw new Error(`Profile not found: "${name}". Profiles: ${names.join(", ")}`);
  }
  return {
    apiKey: profile.apiKey,
    ...(account ?? profile.accountId ? { accountId: account ?? profile.accountId } : {}),
    profile: name,
    source: profile.source === "env" ? "env-profile" : "file-profile",
  };
}

/** `…last4` fingerprint for displaying keys without leaking them. */
export function fingerprint(apiKey: string): string {
  return apiKey.length <= 4 ? "…" : `…${apiKey.slice(-4)}`;
}

export const CONFIG_PATH_FOR_DISPLAY = CONFIG_PATH;
