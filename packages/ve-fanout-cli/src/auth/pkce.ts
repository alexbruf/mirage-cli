import { createHash, randomBytes } from 'node:crypto';

function base64Url(buf: Buffer): string {
	return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generatePkcePair(): { verifier: string; challenge: string } {
	const verifier = base64Url(randomBytes(48));
	const challenge = base64Url(createHash('sha256').update(verifier).digest());
	return { verifier, challenge };
}

export function randomState(bytes = 32): string {
	return base64Url(randomBytes(bytes));
}
