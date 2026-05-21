import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const CONFIG_DIR = join(homedir(), ".config", "reddit-cli");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export interface OAuthState {
  issuer: string;
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope?: string;
}

export interface CLIConfig {
  host?: string;
  token?: string;
  oauth?: OAuthState;
}

export function readConfig(): CLIConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return {};
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as CLIConfig;
  } catch {
    return {};
  }
}

export function writeConfig(next: CLIConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
}

export function updateConfig(partial: Partial<CLIConfig>): CLIConfig {
  const next = { ...readConfig(), ...partial };
  writeConfig(next);
  return next;
}

export interface ResolvedClient {
  host: string;
  token: string;
  kind: "oauth" | "api_key";
  onRefresh?: () => Promise<string | null>;
}

export function resolveClient(): ResolvedClient {
  const cfg = readConfig();
  const host = process.env.REDDIT_API_HOST ?? cfg.host;
  if (!host) {
    console.error(
      `reddit-cli is not configured. Set a host:\n` +
        `  reddit config set-host https://reddit-staging.vieweng.in\n` +
        `\nConfig file: ${CONFIG_PATH}`,
    );
    process.exit(2);
  }
  const envKey = process.env.REDDIT_API_KEY;
  if (envKey) return { host, token: envKey, kind: "api_key" };
  if (cfg.oauth?.accessToken) {
    return {
      host,
      token: cfg.oauth.accessToken,
      kind: "oauth",
      onRefresh: async () => {
        const { refresh } = await import("./oauth.ts");
        const cur = readConfig().oauth;
        if (!cur) return null;
        const next = await refresh(cur);
        return next.accessToken;
      },
    };
  }
  if (cfg.token) return { host, token: cfg.token, kind: "api_key" };
  console.error(
    `reddit-cli has no credentials. Either:\n` +
      `  reddit login             # Clerk OAuth (browser)\n` +
      `  reddit config set-token <api-key>\n` +
      `or export REDDIT_API_KEY.`,
  );
  process.exit(2);
}

export { CONFIG_PATH };
