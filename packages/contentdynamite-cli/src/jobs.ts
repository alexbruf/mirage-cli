import type { z } from 'zod';
import { readText } from './files';
import type { BatchJob } from './wire';

function valueAt(input: unknown, path: readonly PropertyKey[]): unknown {
	let value = input;
	for (const key of path) {
		if (value === null || typeof value !== 'object') return undefined;
		value = (value as Record<PropertyKey, unknown>)[key];
	}
	return value;
}

export function readJobs(path: string): unknown[] {
	const raw: unknown = JSON.parse(readText(path));
	if (!Array.isArray(raw) || raw.length === 0) throw new Error('--jobs file must be a non empty JSON array');
	return raw;
}

export function parseJobs(raw: unknown[], schema: z.ZodObject): BatchJob[] {
	const fields = Object.keys(schema.shape);
	return raw.map((item, index) => {
		if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new Error(`job ${index}: must be a JSON object`);
		const unknown = Object.keys(item).find((key) => !fields.includes(key));
		if (unknown !== undefined) throw new Error(`job ${index}: unknown field '${unknown}'`);
		const parsed = schema.safeParse(item);
		if (parsed.success) return parsed.data;
		const issue = parsed.error.issues[0]!;
		const message = issue.code === 'invalid_type' && valueAt(item, issue.path) === undefined ? 'Field required' : issue.message;
		const location = issue.path.map(String).join('.');
		throw new Error(`job ${index}: ${location ? `${location}: ${message}` : message}`);
	});
}
