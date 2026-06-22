import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { configDir, metadataCachePath } from '../config.ts';

export interface AuthMetadata {
	authorization_endpoint: string;
	token_endpoint: string;
	registration_endpoint?: string;
	revocation_endpoint?: string;
	issuer: string;
	scopes_supported?: string[];
}

interface CachedDiscovery {
	apiUrl: string;
	resource: string;
	authServer: string;
	metadata: AuthMetadata;
	fetchedAt: number;
}

const TTL_MS = 24 * 60 * 60 * 1000;

function loadCache(): Record<string, CachedDiscovery> {
	try {
		return JSON.parse(readFileSync(metadataCachePath(), 'utf8'));
	} catch {
		return {};
	}
}

function saveCache(cache: Record<string, CachedDiscovery>) {
	mkdirSync(configDir(), { recursive: true });
	mkdirSync(dirname(metadataCachePath()), { recursive: true });
	writeFileSync(metadataCachePath(), JSON.stringify(cache, null, 2), { mode: 0o600 });
}

export async function discover(apiUrl: string): Promise<CachedDiscovery> {
	const cache = loadCache();
	const cached = cache[apiUrl];
	if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached;

	const prmRes = await fetch(`${apiUrl}/.well-known/oauth-protected-resource`);
	if (!prmRes.ok) throw new Error(`PRM fetch failed: ${prmRes.status} ${await prmRes.text()}`);
	const prm = (await prmRes.json()) as { resource: string; authorization_servers: string[] };
	const authServer = prm.authorization_servers?.[0];
	if (!authServer) throw new Error('PRM contains no authorization_servers');

	const asRes = await fetch(`${authServer}/.well-known/oauth-authorization-server`);
	if (!asRes.ok) throw new Error(`AS metadata fetch failed: ${asRes.status}`);
	const metadata = (await asRes.json()) as AuthMetadata;

	const entry: CachedDiscovery = { apiUrl, resource: prm.resource, authServer, metadata, fetchedAt: Date.now() };
	cache[apiUrl] = entry;
	saveCache(cache);
	return entry;
}
