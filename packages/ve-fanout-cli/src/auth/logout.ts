import { discover } from './discovery.ts';
import { clearCredentials, loadCredentials } from './tokens.ts';

export async function logout(): Promise<void> {
	const creds = loadCredentials();
	if (!creds) {
		process.stderr.write('Not logged in.\n');
		return;
	}
	try {
		const disc = await discover(creds.apiUrl);
		const revoke = (disc.metadata as { revocation_endpoint?: string }).revocation_endpoint;
		if (revoke && creds.refreshToken) {
			await fetch(revoke, {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					token: creds.refreshToken,
					token_type_hint: 'refresh_token',
					client_id: creds.clientId,
				}).toString(),
			}).catch(() => {
				// network errors during revocation are non-fatal
			});
		}
	} catch {
		// continue with local clearing even if discovery / revoke fails
	}
	clearCredentials();
	process.stderr.write('✓ Logged out.\n');
}
