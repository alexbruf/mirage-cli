import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type Credentials = { login: string; password: string };

const CONFIG_PATH = join(homedir(), ".config", "dataforseo", "config.json");

export function configPath(): string {
  return CONFIG_PATH;
}

export function loadCredentials(): Credentials {
  const env = envCredentials();
  if (env) return env;

  if (existsSync(CONFIG_PATH)) {
    const raw = readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Credentials>;
    if (parsed.login && parsed.password) {
      return { login: parsed.login, password: parsed.password };
    }
  }

  throw new Error(
    `No DataForSEO credentials found.\n` +
      `Either set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD env vars, ` +
      `or run: dfs login --login <email> --password <api_password>`,
  );
}

export function saveCredentials(creds: Credentials): string {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(creds, null, 2));
  chmodSync(CONFIG_PATH, 0o600);
  return CONFIG_PATH;
}

export function basicAuthHeader({ login, password }: Credentials): string {
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
}

function envCredentials(): Credentials | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (login && password) return { login, password };
  return null;
}
