import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { Config } from "./types.ts";

const CONFIG_DIR = join(homedir(), ".config", "clarity-cli");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

function load(): Config {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function save(data: Config): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2) + "\n");
  try { chmodSync(CONFIG_FILE, 0o600); } catch { /* non-POSIX fs */ }
}

export function setToken(token: string): void {
  const data = load();
  data.token = token;
  save(data);
}

export function clearToken(): void {
  const data = load();
  delete data.token;
  save(data);
}

export function getToken(): string | undefined {
  return process.env.CLARITY_API_TOKEN || load().token;
}

export function maskToken(token: string): string {
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export function configPath(): string {
  return CONFIG_FILE;
}
