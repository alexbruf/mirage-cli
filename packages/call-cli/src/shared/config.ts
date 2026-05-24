import { homedir } from "os";
import { join } from "path";
import { mkdirSync, readFileSync, writeFileSync } from "fs";

export interface CliConfig {
  serverUrl: string;
  apiKey?: string;
}

export interface FileConfig {
  server_url?: string;
  elevenlabs_api_key?: string;
  api_key?: string;
}

const CONFIG_DIR = join(homedir(), ".config", "call");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export function loadFileConfig(): FileConfig {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as FileConfig;
  } catch {
    return {};
  }
}

export function saveFileConfig(config: FileConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

export function getCliConfig(): CliConfig {
  const file = loadFileConfig();
  return {
    serverUrl:
      process.env.CALL_SERVER_URL ||
      file.server_url ||
      "http://127.0.0.1:5556",
    apiKey: process.env.CALL_API_KEY || file.api_key || undefined,
  };
}
