/**
 * Credentials for Airtable are dead simple: one Personal Access Token (PAT),
 * used directly as a bearer. Unlike CallRail/HubSpot there's no "account" or
 * profile store — a single PAT is user-scoped and grants access to whichever
 * bases you selected when you created it, so the only per-call choice is which
 * *base* to read (see resolveBase).
 *
 * Resolution precedence (stateless per invocation):
 *   token:  --token > AIRTABLE_API_KEY > AIRTABLE_TOKEN
 *   base:   --base  > AIRTABLE_BASE_ID   (or the explicit [baseId] arg on a command)
 */

const DEFAULT_BASE_URL = "https://api.airtable.com/v0";

export function getDefaultBaseUrl(): string {
  return process.env.AIRTABLE_API_BASE_URL ?? DEFAULT_BASE_URL;
}

export interface CredentialFlags {
  token?: string;
  base?: string;
}

export interface ResolvedToken {
  token: string;
  source: "flag" | "env";
}

/** Resolve the PAT. Throws an actionable error when none is set. */
export function resolveToken(flags: CredentialFlags = {}): ResolvedToken {
  if (flags.token) return { token: flags.token, source: "flag" };
  const env = process.env.AIRTABLE_API_KEY ?? process.env.AIRTABLE_TOKEN;
  if (env) return { token: env, source: "env" };
  throw new Error(
    "No Airtable token. Set AIRTABLE_API_KEY (a personal access token from " +
      "https://airtable.com/create/tokens), or pass --token <pat>.",
  );
}

/**
 * Resolve the base id for a command. `explicit` is a positional [baseId] arg
 * (some commands accept one); otherwise --base / AIRTABLE_BASE_ID. Throws when
 * unset so the caller can surface a structured error.
 */
export function resolveBase(flags: CredentialFlags = {}, explicit?: string): string {
  const base = explicit ?? flags.base ?? process.env.AIRTABLE_BASE_ID;
  if (!base) {
    throw new Error(
      "No Airtable base. Pass --baseId <appXXXXXXXX> (or --base / AIRTABLE_BASE_ID), or run " +
        "`airtable list-bases` to find one.",
    );
  }
  return base;
}

/** `…last4` fingerprint for displaying a token without leaking it. */
export function fingerprint(token: string): string {
  return token.length <= 4 ? "…" : `…${token.slice(-4)}`;
}
