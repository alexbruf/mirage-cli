import { v1alpha, v1beta } from "@google-analytics/admin";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { OAuth2Client } from "google-auth-library";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadOAuthState, refreshIfNeeded } from "./oauth.ts";

/**
 * Hardcoded so we don't have to read package.json at runtime (which is
 * awkward under bundlers and Bun). Keep in sync with package.json.
 */
export const version = "0.1.0";

const CONFIG_DIR = path.join(os.homedir(), ".config", "google-analytics-cli");
const DEFAULT_CREDENTIALS_PATH = path.join(CONFIG_DIR, "credentials.json");
const PROFILES_DIR = path.join(CONFIG_DIR, "profiles");

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
  return undefined;
}

type GoogleClientOptions = ConstructorParameters<typeof BetaAnalyticsDataClient>[0];

/**
 * Build the options bag we hand to every Google client. Precedence:
 *
 *  1. `--credentials` / `--profile` flag         (service account JSON)
 *  2. `GA4_OAUTH_ACCESS_TOKEN` env var           (raw bearer — no refresh)
 *  3. Stored OAuth state from `ga4 login`        (auto-refreshes)
 *  4. Default SA at ~/.config/.../credentials.json
 *  5. GOOGLE_APPLICATION_CREDENTIALS / ADC       (handled by google-auth-library)
 */
async function getClientOptions(): Promise<GoogleClientOptions> {
  // `fallback: 'rest'` forces the Google client libs to use REST transport
  // instead of gRPC. This avoids a known incompatibility between Bun's
  // Headers API and the gRPC metadata-fetch path in `google-gax`
  // (which calls `headers.forEach((value, key) => ...)` on the auth
  // plugin's response — Bun's Headers iterator signature differs).
  // REST is functionally equivalent for everything the CLI does.
  const base = {
    libName: "google-analytics-cli",
    libVersion: version,
    fallback: "rest" as const,
  };

  // 1. SA file path (explicit flag wins)
  if (credentialsPath || profileName) {
    const keyFilename = resolveKeyFilename();
    return keyFilename ? { ...base, keyFilename } : { ...base };
  }

  // 2. Env-var raw bearer token (no refresh attempted)
  const envToken = process.env.GA4_OAUTH_ACCESS_TOKEN;
  if (envToken) {
    const oauth = new OAuth2Client();
    oauth.setCredentials({ access_token: envToken });
    // `authClient` is typed as `AnyAuthClient` (a closed union) in @google-analytics/*.
    // OAuth2Client is the base class of that union but the structural mismatch
    // around `fromJSON` etc. trips TS — the runtime works fine.
    return { ...base, authClient: oauth as never };
  }

  // 3. Stored OAuth tokens from `ga4 login`
  const stored = loadOAuthState();
  if (stored) {
    const refreshed = await refreshIfNeeded(stored);
    const oauth = new OAuth2Client({
      clientId: refreshed.clientId,
      clientSecret: refreshed.clientSecret,
    });
    oauth.setCredentials({
      access_token: refreshed.accessToken,
      refresh_token: refreshed.refreshToken,
      expiry_date: refreshed.expiresAt,
    });
    return { ...base, authClient: oauth as never };
  }

  // 4 + 5. Fall back to SA / ADC (google-auth-library handles GOOGLE_APPLICATION_CREDENTIALS
  // and ~/.config/gcloud/application_default_credentials.json automatically)
  const keyFilename = resolveKeyFilename();
  return keyFilename ? { ...base, keyFilename } : { ...base };
}

export async function createAdminClient(): Promise<
  InstanceType<typeof v1beta.AnalyticsAdminServiceClient>
> {
  return new v1beta.AnalyticsAdminServiceClient(await getClientOptions());
}

export async function createAdminAlphaClient(): Promise<
  InstanceType<typeof v1alpha.AnalyticsAdminServiceClient>
> {
  return new v1alpha.AnalyticsAdminServiceClient(await getClientOptions());
}

export async function createDataClient(): Promise<
  InstanceType<typeof BetaAnalyticsDataClient>
> {
  return new BetaAnalyticsDataClient(await getClientOptions());
}
