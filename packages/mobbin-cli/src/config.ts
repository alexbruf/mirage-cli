import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Mobbin's MCP endpoint, which is also the OAuth protected resource. */
export const DEFAULT_MCP_URL = "https://api.mobbin.com/mcp";

const CONFIG_DIR = join(homedir(), ".config", "mobbin-cli");
/** Read on every call, so `MOBBIN_CLI_CONFIG` set after import still applies. */
export const configPath = (): string => process.env.MOBBIN_CLI_CONFIG ?? join(CONFIG_DIR, "config.json");

/**
 * A dynamically registered OAuth client. Kept so `mobbin login` does not
 * register a new client on every sign-in; reused while the issuer and redirect
 * URI still match.
 */
export interface Registration {
  issuer: string;
  clientId: string;
  redirectUri: string;
}

export interface OAuthState {
  /** The authorization server that issued the tokens. */
  issuer: string;
  tokenEndpoint: string;
  clientId: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. The access token is refreshed a minute before this. */
  expiresAt: number;
}

export interface CLIConfig {
  registration?: Registration;
  oauth?: OAuthState;
}

export function readConfig(): CLIConfig {
  try {
    const path = configPath();
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf8")) as CLIConfig;
  } catch {
    return {};
  }
}

export function writeConfig(next: CLIConfig): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2), { mode: 0o600 });
}

/** `MOBBIN_MCP_URL` beats the production endpoint (tests, proxies). */
export function resolveMcpUrl(): string {
  return (process.env.MOBBIN_MCP_URL ?? DEFAULT_MCP_URL).replace(/\/$/, "");
}
