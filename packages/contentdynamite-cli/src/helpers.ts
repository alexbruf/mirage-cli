import { basename } from 'node:path';
import { type Command, CommanderError, InvalidArgumentError } from 'commander';
import type { Cli } from './context';
import { readText, writeFile } from './files';
import { err } from './output';
import { INTERACTIVE_TYPES } from './wire';

export class Exit extends CommanderError {
	constructor(code: number) {
		super(code, 'commander.exit', '');
	}
}

export const clock = {
	sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
	now: () => performance.now(),
};

export const fmtNum = (value: number) => String(value);

export const splitCsv = (value: string) =>
	value
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);

export function integer(value: string): number {
	if (!/^[+-]?\d+$/.test(value.trim())) throw new InvalidArgumentError('Not a valid integer.');
	return Number.parseInt(value, 10);
}

export function decimal(value: string): number {
	const parsed = Number(value);
	if (!value.trim() || !Number.isFinite(parsed)) throw new InvalidArgumentError('Not a valid number.');
	return parsed;
}

export function between(low: number, high: number) {
	return (value: string) => {
		const parsed = decimal(value);
		if (parsed < low || parsed > high) throw new InvalidArgumentError(`Must be between ${low} and ${high}.`);
		return parsed;
	};
}

export function either(value: string | undefined, file: string | undefined, flags: string): string | undefined {
	if (value && file) throw new Error(`pass either ${flags}, not both`);
	return file ? readText(file) : value;
}

export function documentOutput(command: Command, cli: Cli): Command {
	if (cli.mount) return command.requiredOption('-o, --output <path>', 'Where to write it: a path the host shares with you, such as /data/report.docx');
	return command.option('-o, --output <path>', "Where to write it, defaults to the server's filename in the current directory");
}

export async function downloadDocument(cli: Cli, path: string, format: string, output: string | undefined, fallback: string): Promise<string> {
	if (format !== 'docx' && format !== 'md') throw new Error('--format must be docx or md');
	const { content, filename } = await cli.client().getDownload(path, { format });
	const target = output ?? (filename ? basename(filename) : `${fallback}.${format}`);
	writeFile(target, content);
	return target;
}

export function interactiveFields(value: string | boolean | undefined): Record<string, string | boolean> {
	if (value === undefined) return {};
	if (value === true || value === '') return { generate_interactive: true };
	if (!(INTERACTIVE_TYPES as readonly string[]).includes(value as string)) {
		throw new Error(`invalid interactive type '${value}', valid values: ${INTERACTIVE_TYPES.join(', ')}`);
	}
	return { generate_interactive: true, interactive_type: value };
}

export interface Watch<T> {
	interval: number;
	timeout?: number;
	poll: () => Promise<T>;
	progress: (item: T) => string;
	done: (item: T) => boolean;
	timedOut: (item: T) => string;
}

export async function watchLoop<T>({ interval, timeout, poll, progress, done, timedOut }: Watch<T>): Promise<T> {
	const deadline = timeout === undefined ? null : clock.now() + timeout * 1000;
	for (;;) {
		const item = await poll();
		err(progress(item));
		if (done(item)) return item;
		if (deadline !== null && clock.now() >= deadline) throw new Error(timedOut(item));
		await clock.sleep(Math.max(1, interval) * 1000);
	}
}
