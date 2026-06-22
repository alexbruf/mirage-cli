import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { configDir, credentialsPath } from '../config.ts';

export interface StoredCredentials {
	apiUrl: string;
	authServer: string;
	resource: string;
	accessToken: string;
	refreshToken?: string;
	expiresAt: number;
	scope?: string;
	clientId: string;
	tokenEndpoint: string;
	activeOrgId?: string;
}

export function setActiveOrg(orgId: string | null): void {
	const creds = loadCredentials();
	if (!creds) throw new Error('Not logged in. Run `ve-fanout login` first.');
	if (orgId) creds.activeOrgId = orgId;
	else delete creds.activeOrgId;
	saveCredentials(creds);
}

export function loadCredentials(): StoredCredentials | null {
	try {
		return JSON.parse(readFileSync(credentialsPath(), 'utf8')) as StoredCredentials;
	} catch {
		return null;
	}
}

export function saveCredentials(creds: StoredCredentials): void {
	mkdirSync(configDir(), { recursive: true });
	writeFileSync(credentialsPath(), JSON.stringify(creds, null, 2), { mode: 0o600 });
}

export function clearCredentials(): void {
	try {
		unlinkSync(credentialsPath());
	} catch {
		// already gone
	}
}

interface TokenResponse {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
	scope?: string;
	token_type?: string;
}

export async function refreshAccessToken(creds: StoredCredentials): Promise<StoredCredentials> {
	if (!creds.refreshToken) throw new Error('No refresh token; run `ve-fanout login`');
	const params = new URLSearchParams({
		grant_type: 'refresh_token',
		refresh_token: creds.refreshToken,
		client_id: creds.clientId,
		resource: creds.resource,
	});
	const res = await fetch(creds.tokenEndpoint, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: params.toString(),
	});
	if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
	const body = (await res.json()) as TokenResponse;
	const next: StoredCredentials = {
		...creds,
		accessToken: body.access_token,
		refreshToken: body.refresh_token ?? creds.refreshToken,
		expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
		scope: body.scope ?? creds.scope,
	};
	saveCredentials(next);
	return next;
}

export async function getValidAccessToken(): Promise<string | null> {
	const creds = loadCredentials();
	if (!creds) return null;
	if (Date.now() < creds.expiresAt - 60_000) return creds.accessToken;
	if (!creds.refreshToken) return null;
	try {
		const next = await refreshAccessToken(creds);
		return next.accessToken;
	} catch {
		return null;
	}
}
