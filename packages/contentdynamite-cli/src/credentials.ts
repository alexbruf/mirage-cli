import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { configDir, credentialsPath, envToken } from './config';

export const PAT_PREFIX = 'ved_';
const EXPIRY_SKEW_MS = 60_000;

const storedCredentials = z.object({
	authToken: z.string(),
	email: z.string(),
	username: z.string(),
	profile: z.string().nullable(),
	expiresAt: z.number().int().nullable(),
});

export type StoredCredentials = z.output<typeof storedCredentials>;

export interface ResolvedToken {
	token: string;
	source: 'flag' | 'env' | 'stored';
	credentials: StoredCredentials | null;
}

export const isPat = (token: string) => token.startsWith(PAT_PREFIX);

export function loadCredentials(): StoredCredentials | null {
	try {
		return storedCredentials.parse(JSON.parse(readFileSync(credentialsPath(), 'utf8')));
	} catch {
		return null;
	}
}

export function saveCredentials({ authToken, email, username, profile, expiresAt }: StoredCredentials): void {
	mkdirSync(configDir(), { recursive: true, mode: 0o700 });
	const path = credentialsPath();
	writeFileSync(path, JSON.stringify({ authToken, email, username, profile, expiresAt }, null, 2), { mode: 0o600 });
	chmodSync(path, 0o600);
}

export function clearCredentials(): void {
	try {
		unlinkSync(credentialsPath());
	} catch {
		return;
	}
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
	try {
		const payload: unknown = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
		return payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

export function decodeJwtExp(token: string): number | null {
	const exp = decodeJwtPayload(token)?.exp;
	return typeof exp === 'number' ? exp * 1000 : null;
}

export function resolveToken(flagToken?: string, stored = true): ResolvedToken {
	if (flagToken) return { token: flagToken, source: 'flag', credentials: null };
	const env = envToken();
	if (env) return { token: env, source: 'env', credentials: null };
	if (!stored) throw new Error('no API token, set VE_DYNAMITE_TOKEN or pass --token');
	const credentials = loadCredentials();
	if (!credentials) throw new Error('not logged in, run `ve-dynamite login` or set VE_DYNAMITE_TOKEN');
	if (credentials.expiresAt !== null && Date.now() >= credentials.expiresAt - EXPIRY_SKEW_MS) throw new Error('token expired, run `ve-dynamite login`');
	return { token: credentials.authToken, source: 'stored', credentials };
}
