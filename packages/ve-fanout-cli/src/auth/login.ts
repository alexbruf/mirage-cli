import { defaultApiUrl } from '../config.ts';
import { ensureRegisteredClient } from './dcr.ts';
import { discover } from './discovery.ts';
import { startLoopback } from './loopback.ts';
import { generatePkcePair, randomState } from './pkce.ts';
import { saveCredentials } from './tokens.ts';

interface TokenResponse {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
	scope?: string;
}

export async function login(opts: { apiUrl?: string } = {}): Promise<void> {
	const apiUrl = opts.apiUrl ?? defaultApiUrl();

	process.stderr.write(`→ Discovering ${apiUrl}…\n`);
	const { metadata, authServer, resource } = await discover(apiUrl);
	if (!metadata.registration_endpoint) {
		throw new Error(
			`Authorization server ${authServer} does not expose registration_endpoint. Enable Dynamic Client Registration in the Clerk dashboard.`,
		);
	}

	process.stderr.write('→ Starting local callback server…\n');
	const loop = await startLoopback();

	process.stderr.write('→ Registering OAuth client…\n');
	const client = await ensureRegisteredClient(metadata.registration_endpoint, authServer, loop.redirectUri);

	const { verifier, challenge } = generatePkcePair();
	const state = randomState();
	const params = new URLSearchParams({
		response_type: 'code',
		client_id: client.client_id,
		redirect_uri: loop.redirectUri,
		scope: 'openid profile email offline_access',
		state,
		code_challenge: challenge,
		code_challenge_method: 'S256',
		resource,
	});
	const authUrl = `${metadata.authorization_endpoint}?${params.toString()}`;

	process.stderr.write(`→ Opening browser…\n  ${authUrl}\n`);
	// Lazy-import `open` so the static `buildProgram()` graph never pulls
	// node:child_process at load time — keeps the program importable under
	// workerd (this Node-only path only throws if `login` is actually invoked).
	const { default: open } = await import('open');
	await open(authUrl).catch(() => {
		process.stderr.write('(browser open failed — copy the URL above)\n');
	});

	const cb = await loop.awaitCallback();
	if (cb.state !== state) throw new Error('State mismatch — possible CSRF, aborting login.');

	process.stderr.write('→ Exchanging code for tokens…\n');
	const tokenRes = await fetch(metadata.token_endpoint, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code: cb.code,
			redirect_uri: loop.redirectUri,
			client_id: client.client_id,
			code_verifier: verifier,
			resource,
		}).toString(),
	});
	if (!tokenRes.ok) {
		throw new Error(`Token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
	}
	const tokens = (await tokenRes.json()) as TokenResponse;

	saveCredentials({
		apiUrl,
		authServer,
		resource,
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token,
		expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
		scope: tokens.scope,
		clientId: client.client_id,
		tokenEndpoint: metadata.token_endpoint,
	});

	process.stderr.write('✓ Logged in. Next: `ve-fanout orgs use <id>`\n');
}
