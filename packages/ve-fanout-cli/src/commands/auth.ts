import type { Command } from 'commander';
import { login } from '../auth/login.ts';
import { logout } from '../auth/logout.ts';
import { whoami } from '../auth/whoami.ts';
import { setActiveOrg } from '../auth/tokens.ts';
import type { ApiClient } from '../client.ts';
import { defaultApiUrl } from '../config.ts';
import { selectOrg } from './orgs.ts';

export function registerAuthCommands(program: Command, getClient: () => Promise<ApiClient>): void {
	program
		.command('login')
		.description('Sign in via your browser using OAuth + PKCE')
		.option('--url <url>', 'API base URL', defaultApiUrl())
		.action(async (opts: any) => {
			try {
				await login({ apiUrl: opts.url });
			} catch (err) {
				console.error(`Login failed: ${(err as Error).message}`);
				process.exit(1);
			}
			try {
				const org = await selectOrg(await getClient());
				if (org) {
					setActiveOrg(org.id);
					console.error(`✓ Active org: ${org.name} (${org.id})`);
				} else {
					console.error('No active org set. Run `ve-fanout orgs list` then `ve-fanout orgs use <id>`.');
				}
			} catch (err) {
				console.error(`Signed in, but could not set an org: ${(err as Error).message}`);
				console.error('Run `ve-fanout orgs list` then `ve-fanout orgs use <id>`.');
			}
		});

	program
		.command('logout')
		.description('Revoke refresh token and clear local credentials')
		.action(async () => {
			await logout();
		});

	program
		.command('whoami')
		.description('Print the current authenticated user')
		.action(async () => {
			const code = await whoami();
			if (code !== 0) process.exit(code);
		});
}
