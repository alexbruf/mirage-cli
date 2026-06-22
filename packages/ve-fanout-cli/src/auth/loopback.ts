import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface LoopbackResult {
	code: string;
	state: string;
}

const SUCCESS_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ve-fanout · Login complete</title>
<style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;color:#1a1a1a;background:#fafafa;
       display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
  .card{background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:40px 44px;max-width:460px;text-align:center}
  h1{font-size:24px;margin:0 0 10px}
  p{margin:0 0 8px;color:#666;line-height:1.5}
  code{background:#f3f3f3;padding:2px 6px;border-radius:4px}
</style></head>
<body><div class="card">
  <h1>You're signed in to VE Fanout.</h1>
  <p>Your access token is cached on this machine. Return to your terminal.</p>
  <p>Next: <code>ve-fanout orgs use &lt;id&gt;</code></p>
</div></body></html>`;

export function startLoopback(timeoutMs = 5 * 60_000): Promise<{
	port: number;
	redirectUri: string;
	awaitCallback: () => Promise<LoopbackResult>;
}> {
	return new Promise((resolve, reject) => {
		let resolveCb: ((r: LoopbackResult) => void) | null = null;
		let rejectCb: ((e: Error) => void) | null = null;
		const callback = new Promise<LoopbackResult>((res, rej) => {
			resolveCb = res;
			rejectCb = rej;
		});

		const server = createServer((req, res) => {
			try {
				const u = new URL(req.url ?? '/', 'http://127.0.0.1');
				if (u.pathname !== '/callback') {
					res.writeHead(404);
					res.end();
					return;
				}
				const code = u.searchParams.get('code');
				const state = u.searchParams.get('state');
				const error = u.searchParams.get('error');
				if (error) {
					res.writeHead(400, { 'content-type': 'text/plain' });
					res.end(`OAuth error: ${error}`);
					rejectCb?.(new Error(`OAuth error: ${error}`));
				} else if (code && state) {
					res.writeHead(200, { 'content-type': 'text/html' });
					res.end(SUCCESS_HTML);
					resolveCb?.({ code, state });
				} else {
					res.writeHead(400, { 'content-type': 'text/plain' });
					res.end('Missing code or state');
					rejectCb?.(new Error('Missing code or state on callback'));
				}
			} finally {
				setImmediate(() => server.close());
			}
		});

		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as AddressInfo;
			const timer = setTimeout(() => {
				server.close();
				rejectCb?.(new Error('Login timed out (5 min). Run `ve-fanout login` again.'));
			}, timeoutMs);
			callback.finally(() => clearTimeout(timer));
			resolve({
				port,
				redirectUri: `http://127.0.0.1:${port}/callback`,
				awaitCallback: () => callback,
			});
		});
	});
}
