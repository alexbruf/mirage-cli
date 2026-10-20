import type { Command } from 'commander';
import { ApiClient, ApiError } from '../client';
import type { Cli } from '../context';
import { clearCredentials, decodeJwtExp, isPat, saveCredentials } from '../credentials';
import { err, isoFromMs, out } from '../output';
import type { LoginRes, UserRes } from '../wire';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function signedIn(client: ApiClient, rejected: string): Promise<UserRes> {
	try {
		return await client.get<UserRes>('auth/me');
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) throw new Error(rejected);
		throw error;
	}
}

export function registerAuth(program: Command, cli: Cli): void {
	if (!cli.mount) registerLogin(program, cli);

	program
		.command('whoami')
		.description('Print the signed in identity and its role, checking the token against the API')
		.action(async () => {
			const resolved = cli.token();
			const rejected = cli.mount ? 'not authenticated, the API rejected the token' : 'not authenticated, run `ve-dynamite login`';
			const me = await signedIn(new ApiClient(cli.baseUrl(), resolved.token), rejected);
			const expiresAt = decodeJwtExp(resolved.token);
			out({
				email: me.email,
				username: me.username,
				profile: me.profile,
				role: me.role,
				user_id: me.user_id,
				token_source: resolved.source,
				token_type: isPat(resolved.token) ? 'pat' : 'jwt',
				expires_at: expiresAt ? isoFromMs(expiresAt) : null,
			});
		});
}

function registerLogin(program: Command, cli: Cli): void {
	program
		.command('login')
		.description('Sign in with your Content Dynamite account and store the 24h token locally')
		.requiredOption('--email <email>', 'Account email')
		.requiredOption('--password <password>', 'Account password')
		.action(async (options: { email: string; password: string }) => {
			const res = await new ApiClient(cli.baseUrl(), '').post<LoginRes>('auth/login', { email: options.email, passwd: options.password });
			const expiresAt = decodeJwtExp(res.auth_token) ?? Date.now() + DAY_MS;
			saveCredentials({ authToken: res.auth_token, email: res.email, username: res.username, profile: res.profile, expiresAt });
			err(`✓ Logged in as ${res.username} (${res.email}), token valid until ${isoFromMs(expiresAt)}`);
			out({ email: res.email, username: res.username, role: res.role });
		});

	program
		.command('logout')
		.description('Delete the locally stored credential')
		.action(() => {
			clearCredentials();
			err('✓ Logged out');
		});
}
