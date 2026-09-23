import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_HOST = "https://markup.viewengine.dev";

const CONFIG_DIR = join(homedir(), ".config", "markup-cli");
/** Read on every call, so `MARKUP_CLI_CONFIG` set after import still applies. */
export const configPath = (): string => process.env.MARKUP_CLI_CONFIG ?? join(CONFIG_DIR, "config.json");

export interface OAuthState {
  /** The Markup deployment that issued the tokens; also the OAuth issuer. */
  issuer: string;
  clientId: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. The access token is refreshed a minute before this. */
  expiresAt: number;
  scope?: string;
}

export interface CLIConfig {
  host?: string;
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

export function updateConfig(partial: Partial<CLIConfig>): CLIConfig {
  const next = { ...readConfig(), ...partial };
  writeConfig(next);
  return next;
}

/** `MARKUP_HOST` beats the saved host, which beats the ViewEngine deployment. */
export function resolveHost(): string {
  return (process.env.MARKUP_HOST ?? readConfig().host ?? DEFAULT_HOST).replace(/\/$/, "");
}
