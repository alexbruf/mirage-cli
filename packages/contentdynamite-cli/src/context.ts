import type { Command } from 'commander';
import { ApiClient } from './client';
import { defaultApiUrl } from './config';
import { type ResolvedToken, resolveToken } from './credentials';
import type { ProgramOptions } from './options';

export interface Cli {
	mount: boolean;
	baseUrl(): string;
	token(): ResolvedToken;
	client(): ApiClient;
	follow(watch: string, get: string): string;
	billed(units: number): void;
}

export function cliFor(program: Command, { mount = false, reportCost }: ProgramOptions): Cli {
	const flags = () => program.opts<{ token?: string; url?: string }>();
	const cli: Cli = {
		mount,
		baseUrl: () => flags().url || defaultApiUrl(),
		token: () => resolveToken(flags().token, !mount),
		client: () => new ApiClient(cli.baseUrl(), cli.token().token),
		follow: (watch, get) => `\`ve-dynamite ${mount ? get : watch}\``,
		billed: (units) => {
			if (units > 0) reportCost?.({ provider: 'contentdynamite', units });
		},
	};
	return cli;
}
