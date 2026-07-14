export const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export interface CredentialFlags {
  apiKey?: string;
  baseUrl?: string;
  httpReferer?: string;
  appTitle?: string;
  appCategories?: string;
}

export interface ResolvedConfig {
  apiKey: string;
  baseUrl: string;
  httpReferer?: string;
  appTitle?: string;
  appCategories?: string;
}

export function getDefaultBaseUrl(): string {
  return process.env.OPENROUTER_API_BASE_URL || DEFAULT_BASE_URL;
}

export function resolveConfig(flags: CredentialFlags = {}): ResolvedConfig {
  const apiKey = flags.apiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing OPENROUTER_API_KEY. Set it in the environment or pass --api-key <key>.",
    );
  }
  return {
    apiKey,
    baseUrl: flags.baseUrl || getDefaultBaseUrl(),
    httpReferer: flags.httpReferer || process.env.OPENROUTER_HTTP_REFERER,
    appTitle: flags.appTitle || process.env.OPENROUTER_APP_TITLE,
    appCategories: flags.appCategories || process.env.OPENROUTER_APP_CATEGORIES,
  };
}
