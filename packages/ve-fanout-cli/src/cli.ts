/**
 * VE Fanout CLI as a commander.js program. `buildProgram()` has NO side effects
 * on import (no top-level `.parseAsync()`), so it plugs straight into
 * `@mirage-cli/ve-fanout` and any in-process runner.
 *
 * Read/write boundary (important — these CLIs get wrapped for LLM drivers):
 *   - Reads: `queries list|get|watch`, `engines list`, `credits` (balance /
 *     transactions), `status`, `orgs list|current`, `whoami`.
 *   - BILLABLE writes (consume org credits): `queries create`,
 *     `queries regenerate`, `queries run-engine`.
 *   - Destructive: `queries delete`.
 *   - Local-state / Node-only (touch ~/.config/ve-fanout, open a browser):
 *     `login`, `logout`, `orgs use|clear`. These throw under workerd; gate or
 *     omit them in worker deployments and use a `VE_FANOUT_TOKEN` instead.
 *
 * Worker compatibility: token-based read calls are pure `fetch` and run under
 * workerd. The auth subcommands import `node:fs`/`node:http`/`node:crypto` and
 * lazy-load `open` — workerd stubs those at load and only throws when the
 * command is actually invoked.
 */
import { Command } from 'commander';
import { getValidAccessToken, loadCredentials } from './auth/tokens.ts';
import { ApiClient } from './client.ts';
import { registerAuthCommands } from './commands/auth.ts';
import { registerOrgsCommands } from './commands/orgs.ts';
import { defaultApiUrl, envOrgId, envToken } from './config.ts';

const VERSION = '1.0.0';

function out(data: unknown) {
	console.log(JSON.stringify(data, null, 2));
}

function fail(err: unknown) {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
}

/**
 * Build a fresh, fully-configured `ve-fanout` Commander program. No side
 * effects on import — the caller decides when to `.parseAsync()`.
 */
export function buildProgram(): Command {
	const program = new Command();

	program
		.name('ve-fanout')
		.description('VE Fanout — query fan-out CLI')
		.version(VERSION)
		.option('--token <jwt>', 'Access token override (or set VE_FANOUT_TOKEN env)')
		.option('--url <url>', 'API base URL (or set VE_FANOUT_API_URL env)')
		.option('--org <id>', 'Organization id for this command (overrides the active org)');

	async function getClient(): Promise<ApiClient> {
		const opts = program.opts();
		const baseUrl = opts.url || defaultApiUrl();
		const orgId = opts.org || loadCredentials()?.activeOrgId || envOrgId();
		const explicitToken = opts.token || envToken();
		if (explicitToken) return new ApiClient({ baseUrl, token: explicitToken, orgId });
		const token = await getValidAccessToken();
		if (token) return new ApiClient({ baseUrl, token, orgId });
		console.error('Not authenticated. Run `ve-fanout login`, or set VE_FANOUT_TOKEN for headless use.');
		process.exit(1);
	}

	function getPublicClient(): ApiClient {
		const opts = program.opts();
		return new ApiClient({ baseUrl: opts.url || defaultApiUrl(), token: opts.token || envToken() || '' });
	}

	const queries = program.command('queries').description('Manage fan-out queries');

	queries
		.command('create')
		.description('Submit a query to fan out across engines (BILLABLE: consumes credits)')
		.requiredOption('--query <text>', 'The query to fan out')
		.option('--engines <list>', 'Comma-separated engines (default: all enabled)')
		.option('--country <code>', 'ISO-2 country code for personalization')
		.option('--city <city>', 'City for personalization')
		.option('--region <region>', 'Region for personalization')
		.action(async (opts: any) => {
			try {
				const body: Record<string, unknown> = { query: opts.query };
				if (opts.engines) body.engines = String(opts.engines).split(',').map((e: string) => e.trim()).filter(Boolean);
				if (opts.country || opts.city || opts.region) {
					body.personalization = { country: opts.country ?? null, city: opts.city ?? null, region: opts.region ?? null };
				}
				out(await (await getClient()).post('queries', body));
			} catch (err) {
				fail(err);
			}
		});

	queries
		.command('list')
		.description('List your fan-out sessions')
		.option('--page <n>', 'Page number', '1')
		.option('--limit <n>', 'Results per page', '50')
		.action(async (opts: any) => {
			try {
				out(await (await getClient()).list('queries', { page: opts.page, limit: opts.limit }));
			} catch (err) {
				fail(err);
			}
		});

	queries
		.command('get <sessionId>')
		.description('Get a session with all engine results')
		.action(async (sessionId: string) => {
			try {
				out(await (await getClient()).get(`queries/${sessionId}`));
			} catch (err) {
				fail(err);
			}
		});

	queries
		.command('delete <sessionId>')
		.description('Delete a session (destructive)')
		.action(async (sessionId: string) => {
			try {
				out(await (await getClient()).del(`queries/${sessionId}`));
			} catch (err) {
				fail(err);
			}
		});

	queries
		.command('regenerate <sessionId>')
		.description('Re-run all engines for a session as a new version (BILLABLE: consumes credits)')
		.action(async (sessionId: string) => {
			try {
				out(await (await getClient()).post(`queries/${sessionId}/regenerate`));
			} catch (err) {
				fail(err);
			}
		});

	queries
		.command('run-engine <sessionId> <engine>')
		.description('Re-run a single engine for a session (BILLABLE: consumes credits)')
		.action(async (sessionId: string, engine: string) => {
			try {
				out(await (await getClient()).post(`queries/${sessionId}/run-engine`, { engine }));
			} catch (err) {
				fail(err);
			}
		});

	queries
		.command('watch <sessionId>')
		.description('Poll a session until every engine finishes')
		.option('--interval <seconds>', 'Poll interval', '3')
		.option('--timeout <seconds>', 'Give up after this many seconds', '180')
		.action(async (sessionId: string, opts: any) => {
			try {
				const client = await getClient();
				const intervalMs = Math.max(1, Number(opts.interval) || 3) * 1000;
				const deadline = Date.now() + Math.max(1, Number(opts.timeout) || 180) * 1000;
				while (true) {
					const row = await client.get<{ engines: Array<{ engine: string; status: string }> }>(`queries/${sessionId}`);
					const engines = row.engines ?? [];
					const pending = engines.filter((e) => e.status !== 'success' && e.status !== 'error');
					if (engines.length > 0 && pending.length === 0) {
						out(row);
						return;
					}
					if (Date.now() >= deadline) {
						console.error(`Timed out with ${pending.length}/${engines.length} engines still pending.`);
						out(row);
						process.exit(1);
					}
					await new Promise((r) => setTimeout(r, intervalMs));
				}
			} catch (err) {
				fail(err);
			}
		});

	const engines = program.command('engines').description('View engines');

	engines
		.command('list')
		.description('List available engines and whether they are enabled for your org')
		.action(async () => {
			try {
				out(await (await getClient()).list('engines'));
			} catch (err) {
				fail(err);
			}
		});

	const credits = program.command('credits').description('View credits');

	credits
		.command('balance', { isDefault: true })
		.description('Show the org credit balance')
		.action(async () => {
			try {
				out(await (await getClient()).get('credits'));
			} catch (err) {
				fail(err);
			}
		});

	credits
		.command('transactions')
		.description('List credit transactions')
		.option('--page <n>', 'Page number', '1')
		.option('--limit <n>', 'Results per page', '50')
		.action(async (opts: any) => {
			try {
				out(await (await getClient()).list('credits/transactions', { page: opts.page, limit: opts.limit }));
			} catch (err) {
				fail(err);
			}
		});

	program
		.command('status')
		.description('Show service health (public endpoint)')
		.action(async () => {
			try {
				out(await getPublicClient().raw('/api/status'));
			} catch (err) {
				fail(err);
			}
		});

	registerAuthCommands(program, getClient);
	registerOrgsCommands(program, getClient);

	program.addHelpText(
		'after',
		`
Examples:
  ve-fanout status                                      public health check (no auth)
  ve-fanout queries create --query "best running shoes" submit a fan-out (billable)
  ve-fanout queries watch <sessionId>                   block until engines finish
  ve-fanout queries get <sessionId>                     one session + all engine results
  ve-fanout engines list                                engines enabled for your org
  ve-fanout credits                                     org credit balance

Auth: set VE_FANOUT_TOKEN (+ optional VE_FANOUT_ORG_ID / VE_FANOUT_API_URL) for
headless use, or run \`ve-fanout login\` for an interactive browser sign-in.
`,
	);

	return program;
}
