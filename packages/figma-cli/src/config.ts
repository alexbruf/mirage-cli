/**
 * Figma accepts two credential kinds and they are NOT interchangeable at the
 * header level:
 *
 *   - Personal access token (`figd_…`) → `X-Figma-Token: <t>`
 *   - OAuth 2 access token             → `Authorization: Bearer <t>`
 *
 * Sending a PAT as a bearer, or an OAuth token in X-Figma-Token, is a 403 with
 * an unhelpful body — so the scheme travels with the token rather than being
 * guessed at the call site.
 *
 * Resolution precedence (stateless per invocation):
 *   token:  --token > FIGMA_OAUTH_ACCESS_TOKEN > FIGMA_TOKEN > FIGMA_API_KEY
 *                   > FIGMA_PERSONAL_ACCESS_TOKEN
 *   scheme: --auth-scheme > (bearer when it came from FIGMA_OAUTH_ACCESS_TOKEN)
 *                         > inferred from the token prefix > x-figma-token
 *
 * Personal access tokens expire within 90 days of creation and cannot be
 * renewed in place, so long-lived deployments should prefer the OAuth path.
 */

const DEFAULT_BASE_URL = "https://api.figma.com";

export function getDefaultBaseUrl(): string {
  return process.env.FIGMA_API_BASE_URL ?? DEFAULT_BASE_URL;
}

export type AuthScheme = "bearer" | "x-figma-token";

export const AUTH_SCHEMES: readonly AuthScheme[] = ["bearer", "x-figma-token"];

export interface CredentialFlags {
  token?: string;
  authScheme?: string;
  fileKey?: string;
  teamId?: string;
}

export interface ResolvedToken {
  token: string;
  scheme: AuthScheme;
  source: "flag" | "oauth-env" | "pat-env";
}

export function parseAuthScheme(raw: string | undefined): AuthScheme | undefined {
  if (raw === undefined) return undefined;
  const scheme = raw as AuthScheme;
  if (!AUTH_SCHEMES.includes(scheme)) {
    throw new Error(`Unknown auth scheme "${raw}". Schemes: ${AUTH_SCHEMES.join(", ")}`);
  }
  return scheme;
}

/**
 * Infer the header from the token's own prefix. Figma stamps issuer prefixes on
 * both kinds: `figd_` on personal access tokens, `figu_`/`figoa` on OAuth
 * access tokens. Anything unrecognised falls back to the PAT header, which is
 * the documented default for a hand-pasted credential.
 */
function inferScheme(token: string): AuthScheme {
  if (token.startsWith("figu_") || token.startsWith("figoa")) return "bearer";
  return "x-figma-token";
}

/** Resolve the credential and the header it must travel in. Throws when none is set. */
export function resolveToken(flags: CredentialFlags = {}): ResolvedToken {
  const override = parseAuthScheme(flags.authScheme);

  if (flags.token) {
    return {
      token: flags.token,
      scheme: override ?? inferScheme(flags.token),
      source: "flag",
    };
  }

  const oauth = process.env.FIGMA_OAUTH_ACCESS_TOKEN;
  if (oauth) {
    return { token: oauth, scheme: override ?? "bearer", source: "oauth-env" };
  }

  const pat =
    process.env.FIGMA_TOKEN ??
    process.env.FIGMA_API_KEY ??
    process.env.FIGMA_PERSONAL_ACCESS_TOKEN;
  if (pat) {
    return { token: pat, scheme: override ?? inferScheme(pat), source: "pat-env" };
  }

  throw new Error(
    "No Figma credential. Set FIGMA_TOKEN (a personal access token from " +
      "https://www.figma.com/developers/api#access-tokens), or FIGMA_OAUTH_ACCESS_TOKEN " +
      "for an OAuth install, or pass --token <token>.",
  );
}

/**
 * Figma file keys are usually copied out of a URL rather than typed, so accept
 * either. Both the modern `/design/` and the legacy `/file/` URL shapes carry
 * the key in the same position:
 *   https://www.figma.com/design/:key/:name?node-id=1-23
 *   https://www.figma.com/file/:key/:name
 * `/board/` (FigJam) and `/slides/` (Figma Slides) follow the same layout.
 */
export function parseFileKey(raw: string): string {
  if (!raw.includes("figma.com/")) return raw;
  const match = /figma\.com\/(?:design|file|board|slides|proto)\/([A-Za-z0-9]+)/.exec(raw);
  if (!match?.[1]) {
    throw new Error(
      `Could not read a file key out of "${raw}". Expected a key, or a URL like ` +
        "https://www.figma.com/design/<key>/<name>.",
    );
  }
  return match[1];
}

/** Resolve a file key from a positional arg, else --file-key / FIGMA_FILE_KEY. */
export function resolveFileKey(flags: CredentialFlags = {}, explicit?: string): string {
  const raw = explicit ?? flags.fileKey ?? process.env.FIGMA_FILE_KEY;
  if (!raw) {
    throw new Error(
      "No Figma file. Pass the file key or its URL as an argument (or --file-key / FIGMA_FILE_KEY).",
    );
  }
  return parseFileKey(raw);
}

/** Resolve a team id from a positional arg, else --team-id / FIGMA_TEAM_ID. */
export function resolveTeamId(flags: CredentialFlags = {}, explicit?: string): string {
  const raw = explicit ?? flags.teamId ?? process.env.FIGMA_TEAM_ID;
  if (!raw) {
    throw new Error(
      "No Figma team. Pass a team id as an argument (or --team-id / FIGMA_TEAM_ID). The id is " +
        "the number in a team URL: https://www.figma.com/files/team/<team_id>/…",
    );
  }
  const match = /\/team\/(\d+)/.exec(raw);
  return match?.[1] ?? raw;
}

/**
 * Figma node ids appear as `1:23` in the API and `1-23` in URLs (the colon is
 * not URL-safe). Accept either spelling everywhere and normalise to the API's.
 */
export function normalizeNodeIds(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s.replace(/-/g, ":"));
}

/** `…last4` fingerprint for displaying a token without leaking it. */
export function fingerprint(token: string): string {
  return token.length <= 4 ? "…" : `…${token.slice(-4)}`;
}
