import { Option, type Command } from 'commander';
import type { Cli } from '../context';
import { integer } from '../helpers';
import { err, out } from '../output';
import { USER_ROLES, type SetRoleRes } from '../wire';

export function registerUsers(program: Command, cli: Cli): void {
	const users = program.command('users').description('Every account in the system and its role (admins only)');

	users
		.command('list')
		.description('List accounts, newest first, with their roles')
		.addOption(new Option('--role <role>', 'Only accounts with this role').choices(USER_ROLES))
		.option('--page <page>', 'Page number', integer, 1)
		.option('--limit <limit>', 'Page size (max 100)', integer, 20)
		.action(async (options: { role?: string; page: number; limit: number }) => {
			out(await cli.client().get('users/', { page: options.page, limit: options.limit, role: options.role }));
		});

	users
		.command('set-role')
		.description('Make another account an admin or a normal user. Nobody can change their own role, so an admin always remains')
		.argument('<USER-ID>', 'Account id', integer)
		.addOption(new Option('--role <role>', 'The new role').choices(USER_ROLES).makeOptionMandatory())
		.action(async (userId: number, options: { role: string }) => {
			const res = await cli.client().patch<SetRoleRes>(`users/${userId}/role`, { role: options.role });
			err(res.msg);
			out(res);
		});
}
