import { ApiClient, ApiError } from "./client.ts";
import {
  clearSession,
  getDefaultBaseUrl,
  loadSession,
  SESSION_PATH_FOR_DISPLAY,
  type Session,
  saveSession,
} from "./config.ts";
import { runOAuthLogin } from "./oauth.ts";

export async function loginWithApiKey(apiKey: string, baseUrl?: string): Promise<void> {
  const session: Session = {
    apiKey,
    baseUrl: baseUrl ?? getDefaultBaseUrl(),
    savedAt: new Date().toISOString(),
  };
  const client = new ApiClient(session);
  try {
    const result = await client.request<string>("/protected");
    console.log(`✓ ${typeof result === "string" ? result : "Authenticated"}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      console.error("✗ Invalid API key (401 Unauthorized)");
      process.exit(1);
    }
    throw err;
  }
  saveSession(session);
  console.log(`Session saved to ${SESSION_PATH_FOR_DISPLAY}`);
}

export async function loginWithOAuth(baseUrl?: string): Promise<void> {
  const resolvedBaseUrl = baseUrl ?? getDefaultBaseUrl();
  const tokens = await runOAuthLogin(resolvedBaseUrl);
  const session: Session = {
    baseUrl: resolvedBaseUrl,
    savedAt: new Date().toISOString(),
    accessToken: tokens.accessToken,
    ...(tokens.refreshToken !== undefined ? { refreshToken: tokens.refreshToken } : {}),
    expiresAt: tokens.expiresAt,
    tokenEndpoint: tokens.tokenEndpoint,
    clientId: tokens.clientId,
  };
  const client = new ApiClient(session);
  try {
    const result = await client.request<string>("/protected");
    console.log(`✓ ${typeof result === "string" ? result : "Authenticated"}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      console.error("✗ OAuth token rejected by API (401)");
      process.exit(1);
    }
    throw err;
  }
  saveSession(session);
  console.log(`Session saved to ${SESSION_PATH_FOR_DISPLAY}`);
}

export async function whoami(): Promise<void> {
  const session = loadSession();
  if (!session) {
    console.error("Not logged in. Run: radar login  (or: radar login --api-key <key>)");
    process.exit(1);
  }
  const client = new ApiClient(session);
  try {
    const result = await client.request<string>("/protected");
    console.log(typeof result === "string" ? result : JSON.stringify(result));
    console.log(`Base URL: ${session.baseUrl}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      console.error("Session expired or invalid. Run: radar login");
      process.exit(1);
    }
    throw err;
  }
}

export function logout(): void {
  clearSession();
  console.log("Logged out.");
}
