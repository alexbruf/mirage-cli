import { readFileSync, writeFileSync } from 'node:fs';

interface FileBridge {
	canHandle(path: string): boolean;
	readFileSync(path: string): Uint8Array | string | null;
	writeFileSync(path: string, data: string | Uint8Array): boolean;
}

function bridgeFor(path: string): FileBridge | null {
	const bridge = (globalThis as { __MIRAGE_CLI_FILE_IO__?: FileBridge }).__MIRAGE_CLI_FILE_IO__;
	return bridge?.canHandle(path) ? bridge : null;
}

function read(path: string): Uint8Array<ArrayBuffer> {
	const bridge = bridgeFor(path);
	if (!bridge) return new Uint8Array(readFileSync(path));
	const data = bridge.readFileSync(path);
	if (data === null) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
	return new Uint8Array(typeof data === 'string' ? new TextEncoder().encode(data) : data);
}

export function readBytes(path: string): Uint8Array<ArrayBuffer> {
	try {
		return read(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`file not found: ${path}`);
		throw error;
	}
}

export const readText = (path: string) => new TextDecoder().decode(readBytes(path));

export function writeFile(path: string, data: string | Uint8Array): void {
	const bridge = bridgeFor(path);
	if (!bridge) {
		writeFileSync(path, data);
		return;
	}
	if (!bridge.writeFileSync(path, data)) throw new Error(`could not write ${path}`);
}
