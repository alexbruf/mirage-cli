import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { clientsPath, configDir } from '../config.ts';

interface RegisteredClient {
	client_id: string;
	client_secret?: string;
	registration_access_token?: string;
	registration_client_uri?: string;
}

interface ClientCacheEntry extends RegisteredClient {
	authServer: string;
	redirectUri: string;
}

function loadClients(): Record<string, ClientCacheEntry> {
	try {
		return JSON.parse(readFileSync(clientsPath(), 'utf8'));
	} catch {
		return {};
	}
}

function saveClients(map: Record<string, ClientCacheEntry>) {
	mkdirSync(configDir(), { recursive: true });
	writeFileSync(clientsPath(), JSON.stringify(map, null, 2), { mode: 0o600 });
}

function cacheKey(authServer: string, redirectUri: string): string {
	return `${authServer}::${redirectUri}`;
}

export async function ensureRegisteredClient(
	registrationEndpoint: string,
	authServer: string,
	redirectUri: string,
): Promise<RegisteredClient> {
	const cache = loadClients();
	const key = cacheKey(authServer, redirectUri);
	const cached = cache[key];
	if (cached?.client_id) return cached;

	const clientName = `ve-fanout CLI (${userInfo().username}@${hostname()})`;
	const res = await fetch(registrationEndpoint, {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'application/json' },
		body: JSON.stringify({
			client_name: clientName,
			redirect_uris: [redirectUri],
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none',
			scope: 'openid profile email offline_access',
		}),
	});
	if (!res.ok) throw new Error(`DCR failed: ${res.status} ${await res.text()}`);
	const body = (await res.json()) as RegisteredClient;
	cache[key] = { ...body, authServer, redirectUri };
	saveClients(cache);
	return body;
}
