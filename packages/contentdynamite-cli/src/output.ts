export const io = {
	stdout: (text: string) => void process.stdout.write(text),
	stderr: (text: string) => void process.stderr.write(text),
};

export function out(data: unknown): void {
	io.stdout(`${JSON.stringify(data, null, 2)}\n`);
}

export function err(message: string): void {
	io.stderr(`${message}\n`);
}

export function line(message: string): void {
	io.stdout(`${message}\n`);
}

export function write(text: string): void {
	io.stdout(text.endsWith('\n') || text === '' ? text : `${text}\n`);
}

export const isoNow = () => new Date().toISOString();

export const isoFromMs = (ms: number) => new Date(ms).toISOString();
