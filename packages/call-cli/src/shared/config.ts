import { homedir } from "os";
import { join } from "path";
import { mkdirSync, readFileSync, writeFileSync } from "fs";

export interface ServerConfig {
  port: number;
  callgateUrl: string;
  callgateUser: string;
  callgatePass: string;
  bluealsaDev: string;
  audioDir: string;
  defaultSilenceSecs: number;
}

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

export function getServerConfig(): ServerConfig {
  const audioDir = (
    process.env.CALL_AUDIO_DIR || "~/.call-cli/audio"
  ).replace(/^~/, homedir());
  return {
    port: parseInt(process.env.CALL_SERVER_PORT || "5556", 10),
    callgateUrl: process.env.CALLGATE_URL || "http://10.0.0.108:8084",
    callgateUser: process.env.CALLGATE_USER || "call",
    callgatePass: process.env.CALLGATE_PASS || "",
    bluealsaDev: process.env.BLUEALSA_DEV || "74:BE:F3:25:5D:D2",
    audioDir,
    defaultSilenceSecs: parseInt(
      process.env.DEFAULT_SILENCE_SECS || "20",
      10,
    ),
  };
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
