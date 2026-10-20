import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_API_URL = 'https://content-dynamite.alexthecomputer1.workers.dev';

export function configDir(): string {
	const override = process.env.VE_DYNAMITE_CONFIG_DIR;
	if (override) return override;
	const xdg = process.env.XDG_CONFIG_HOME;
	return xdg ? join(xdg, 've-dynamite') : join(homedir(), '.config', 've-dynamite');
}

export const credentialsPath = () => join(configDir(), 'credentials.json');

export const imageJobsPath = () => join(configDir(), 'image-jobs.json');

export function defaultApiUrl(): string {
	return process.env.VE_DYNAMITE_API_URL || DEFAULT_API_URL;
}

export function envToken(): string | undefined {
	return process.env.VE_DYNAMITE_TOKEN || undefined;
}
