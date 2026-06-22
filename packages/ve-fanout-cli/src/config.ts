import { homedir } from 'node:os';
import { join } from 'node:path';

export function configDir(): string {
	if (process.env.VE_FANOUT_CONFIG_DIR) return process.env.VE_FANOUT_CONFIG_DIR;
	const xdg = process.env.XDG_CONFIG_HOME;
	return xdg ? join(xdg, 've-fanout') : join(homedir(), '.config', 've-fanout');
}

export const credentialsPath = () => join(configDir(), 'credentials.json');
export const clientsPath = () => join(configDir(), 'clients.json');
export const metadataCachePath = () => join(configDir(), 'metadata.json');

export function defaultApiUrl(): string {
	return process.env.VE_FANOUT_API_URL || 'https://fanout.api.viewengine.ai';
}

export function envToken(): string | undefined {
	return process.env.VE_FANOUT_TOKEN;
}

export function envOrgId(): string | undefined {
	return process.env.VE_FANOUT_ORG_ID;
}
