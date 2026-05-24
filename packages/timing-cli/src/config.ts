import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const BASE_URL = "https://web.timingapp.com/api/v1";

export function getConfigDir(): string {
  return join(homedir(), ".config", "timing-cli");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

function readConfigToken(): string | undefined {
  const path = getConfigPath();
  if (!existsSync(path)) return undefined;
  try {
    const config = JSON.parse(readFileSync(path, "utf-8"));
    return config.api_token || undefined;
  } catch {
    return undefined;
  }
}

export function saveConfig(apiToken: string): void {
  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify({ api_token: apiToken }, null, 2) + "\n", {
    mode: 0o600,
  });
}

export function getToken(): string {
  const token = process.env.TIMING_API_TOKEN || readConfigToken();
  if (!token) {
    console.error("Error: No API token found.");
    console.error("Run `timing setup` to configure, or set TIMING_API_TOKEN env var.");
    process.exit(1);
  }
  return token;
}

export function getBaseUrl(): string {
  return BASE_URL;
}
