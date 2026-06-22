import type { Command } from 'commander';
import { loadCredentials, setActiveOrg } from '../auth/tokens.ts';
import type { ApiClient } from '../client.ts';

interface Org {
	id: string;
	name: string;
	slug: string | null;
	role: string;
}

function printOrgList(list: Org[]): void {
	for (const o of list) console.error(`  ${o.id}  (${o.slug ?? 'no-slug'})  — ${o.name}`);
}

export async function selectOrg(client: ApiClient): Promise<Org | null> {
	const data = await client.list<Org>('orgs');
	const list = data.rows;
	if (list.length === 0) {
		console.error('You are not a member of any organization. Create one in the web app first.');
		return null;
	}
	if (list.length === 1) return list[0] ?? null;
	console.error('Multiple organizations found — set one with `ve-fanout orgs use <id>` or --org <id>:');
	printOrgList(list);
	return null;
}

export function registerOrgsCommands(program: Command, getClient: () => Promise<ApiClient>): void {
	const orgs = program.command('orgs').description('List and switch organizations');

	orgs
		.command('list')
		.description("List the orgs you're a member of")
		.action(async () => {
			try {
				const client = await getClient();
				const data = await client.list<Org>('orgs');
				const active = loadCredentials()?.activeOrgId;
				const rows = data.rows.map((o) => ({ ...o, active: o.id === active }));
				console.log(JSON.stringify({ rows, total: data.total, active_org_id: active }, null, 2));
			} catch (err) {
				console.error(err instanceof Error ? err.message : String(err));
				process.exit(1);
			}
		});

	orgs
		.command('use <id-or-slug>')
		.description('Set the active org by id or slug')
		.action(async (idOrSlug: string) => {
			try {
				const client = await getClient();
				const data = await client.list<Org>('orgs');
				const match = data.rows.find((o) => o.id === idOrSlug || o.slug === idOrSlug);
				if (!match) {
					console.error(`Org not found: ${idOrSlug}`);
					console.error('Available orgs:');
					printOrgList(data.rows);
					process.exit(1);
				}
				setActiveOrg(match.id);
				console.error(`✓ Active org: ${match.name} (${match.id})`);
			} catch (err) {
				console.error(err instanceof Error ? err.message : String(err));
				process.exit(1);
			}
		});

	orgs
		.command('current')
		.description('Print the active org')
		.action(() => {
			const creds = loadCredentials();
			if (!creds) {
				console.error('Not logged in. Run `ve-fanout login` first.');
				process.exit(1);
			}
			if (!creds.activeOrgId) {
				console.error('No active org set. Run `ve-fanout orgs use <id>` to choose one.');
				return;
			}
			console.log(creds.activeOrgId);
		});

	orgs
		.command('clear')
		.description('Clear the active org override')
		.action(() => {
			setActiveOrg(null);
			console.error('✓ Active org cleared.');
		});
}
