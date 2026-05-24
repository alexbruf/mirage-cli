import { homedir } from "os";
import { join } from "path";
import { mkdirSync, readFileSync, writeFileSync } from "fs";

export type GatewayMode = "proxy" | "private";

export interface ServerConfig {
  port: number;
  dbPath: string;
  gatewayMode: GatewayMode;
  // Proxy mode
  asgEndpoint: string;
  asgUsername: string;
  asgPassword: string;
  // Private mode
  privateToken: string;
  publicUrl: string;
  webhookSigningKey: string;
}

export interface CliConfig {
  serverUrl: string;
}

export interface FileConfig {
  server_url?: string;
}

const CONFIG_DIR = join(homedir(), ".config", "sms");
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
  const dbPathRaw = process.env.SMS_DB_PATH || "~/.sms-inbox/messages.db";
  const dbPath = dbPathRaw.replace(/^~/, homedir());
  return {
    port: parseInt(process.env.SMS_SERVER_PORT || "5555", 10),
    dbPath,
    gatewayMode: (process.env.GATEWAY_MODE as GatewayMode) || "proxy",
    asgEndpoint: process.env.ASG_ENDPOINT || "",
    asgUsername: process.env.ASG_USERNAME || "",
    asgPassword: process.env.ASG_PASSWORD || "",
    privateToken: process.env.PRIVATE_TOKEN || "",
    publicUrl: process.env.PUBLIC_URL || "",
    webhookSigningKey: process.env.WEBHOOK_SIGNING_KEY || "",
  };
}

export function getCliConfig(): CliConfig {
  const file = loadFileConfig();
  return {
    serverUrl: process.env.SMS_SERVER_URL || file.server_url || "http://127.0.0.1:5555",
  };
}
