import { ApiClient, ApiError } from "./client.ts";
import {
  clearSession,
  getDefaultBaseUrl,
  loadSession,
  saveSession,
  SESSION_PATH_FOR_DISPLAY,
  type Session,
} from "./config.ts";

export interface TokenInfo {
  id?: string;
  name?: string;
  type?: "full_access" | "custom" | "read_only";
  scopes?: string[];
  team_id?: string;
  [k: string]: unknown;
}

export async function loginWithToken(token: string, baseUrl?: string): Promise<void> {
  const session: Session = {
    token,
    baseUrl: baseUrl ?? getDefaultBaseUrl(),
    savedAt: new Date().toISOString(),
  };
  const client = new ApiClient(session);
  try {
    const info = await client.request<TokenInfo>("/auth/token");
    console.log(
      `✓ Authenticated (type: ${info.type ?? "unknown"}, team: ${info.team_id ?? "?"})`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      console.error("✗ Invalid token (401 Unauthorized)");
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
    console.error("Not logged in. Run: presscart login --token pc_...");
    process.exit(1);
  }
  const client = new ApiClient(session);
  try {
    const info = await client.request<TokenInfo>("/auth/token");
    console.log(JSON.stringify(info, null, 2));
    console.log(`\nBase URL: ${session.baseUrl}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      console.error("Session expired or invalid. Run: presscart login --token pc_...");
      process.exit(1);
    }
    throw err;
  }
}

export function logout(): void {
  clearSession();
  console.log("Logged out.");
}
