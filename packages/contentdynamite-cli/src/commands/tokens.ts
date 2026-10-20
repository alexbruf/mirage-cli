import type { Command } from 'commander';
import { ApiClient } from '../client';
import type { Cli } from '../context';
import { isPat, saveCredentials } from '../credentials';
import { integer } from '../helpers';
import { err, out } from '../output';
import type { CreateApiTokenRes } from '../wire';
import { signedIn } from './auth';

export function registerTokens(program: Command, cli: Cli): void {
	const tokens = program.command('tokens').description('Manage long lived API tokens for MCP and CI usage');

	tokens
		.command('create')
		.description('Create a long lived API token (the raw token is shown once, store it now)')
		.requiredOption('--name <name>', 'Token label, e.g. claude-mcp')
		.option('--expires-days <days>', 'Days until the token expires (omit for a token that never expires)', integer)
		.action(async (options: { name: string; expiresDays?: number }) => {
			const body: Record<string, unknown> = { name: options.name };
			if (options.expiresDays !== undefined) body.expires_in_days = options.expiresDays;
			const res = await cli.client().post<CreateApiTokenRes>('api-tokens/', body);
			err(cli.mount ? '✓ Token created. Its token field is the only time it is shown, store it now' : `✓ Token created. This is the only time it is shown, store it now:\n\n  ${res.token}\n`);
			out(res);
		});

	tokens
		.command('list')
		.description('List your API tokens (masked, includes revoked ones)')
		.action(async () => out(await cli.client().get('api-tokens/')));

	tokens
		.command('revoke')
		.description('Revoke an API token by id')
		.argument('<ID>', 'Token id', integer)
		.action(async (tokenId: number) => out(await cli.client().delete(`api-tokens/${tokenId}`)));

	if (cli.mount) return;

	tokens
		.command('use')
		.description('Store a ved_ API token as the local credential (replaces the stored login)')
		.argument('<TOKEN>', 'The ved_ token')
		.action(async (token: string) => {
			if (!isPat(token)) throw new Error('not an API token, expected a ved_ prefix; for a password login run `ve-dynamite login`');
			const me = await signedIn(new ApiClient(cli.baseUrl(), token), 'token rejected by the API, it may be revoked or expired');
			saveCredentials({ authToken: token, email: me.email, username: me.username, profile: me.profile, expiresAt: null });
			err(`✓ API token for ${me.username} stored, it will be used for all commands until you run \`login\` or \`logout\``);
		});
}
