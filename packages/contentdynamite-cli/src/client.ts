export type Params = Record<string, string | number | boolean | null | undefined>;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface Payload {
	params?: Params;
	body?: unknown;
	form?: FormData;
}

export class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

function describeDetail(text: string): string | null {
	try {
		const detail = (JSON.parse(text) as { detail?: unknown }).detail;
		if (typeof detail === 'string') return detail;
		if (Array.isArray(detail)) return detail.map((item: { loc?: unknown[]; msg?: unknown }) => `${(item.loc ?? []).slice(1).join('.')}: ${item.msg}`).join('; ');
		return null;
	} catch {
		return null;
	}
}

async function apiError(response: Response): Promise<ApiError> {
	const text = await response.text();
	return new ApiError(response.status, `${response.status}: ${describeDetail(text) ?? (text || response.statusText)}`);
}

export class ApiClient {
	constructor(
		readonly baseUrl: string,
		readonly token: string,
	) {}

	get<T = unknown>(path: string, params?: Params): Promise<T> {
		return this.json('GET', path, { params });
	}

	async getText(path: string, params?: Params): Promise<string> {
		return (await this.request('GET', path, { params })).text();
	}

	async getDownload(path: string, params?: Params): Promise<{ content: Uint8Array; filename: string | null }> {
		const response = await this.request('GET', path, { params });
		const filename = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? null;
		return { content: new Uint8Array(await response.arrayBuffer()), filename };
	}

	post<T = unknown>(path: string, body?: unknown, params?: Params): Promise<T> {
		return this.json('POST', path, { body, params });
	}

	postForm<T = unknown>(path: string, file: Blob, filename: string, params?: Params): Promise<T> {
		const form = new FormData();
		form.append('file', file, filename);
		return this.json('POST', path, { form, params });
	}

	put<T = unknown>(path: string, body?: unknown): Promise<T> {
		return this.json('PUT', path, { body });
	}

	patch<T = unknown>(path: string, body?: unknown): Promise<T> {
		return this.json('PATCH', path, { body });
	}

	delete<T = unknown>(path: string): Promise<T> {
		return this.json('DELETE', path, {});
	}

	private async json<T>(method: Method, path: string, payload: Payload): Promise<T> {
		return (await (await this.request(method, path, payload)).json()) as T;
	}

	private async request(method: Method, path: string, { params, body, form }: Payload): Promise<Response> {
		const headers: Record<string, string> = this.token ? { Authorization: `Bearer ${this.token}` } : {};
		let content: FormData | string | undefined = form;
		if (!form && method !== 'GET' && method !== 'DELETE') {
			headers['Content-Type'] = 'application/json';
			content = body == null ? undefined : JSON.stringify(body);
		}
		const response = await fetch(this.url(path, params), { method, headers, body: content, redirect: 'manual' });
		if (!response.ok) throw await apiError(response);
		return response;
	}

	private url(path: string, params?: Params): string {
		const query = new URLSearchParams();
		for (const [key, value] of Object.entries(params ?? {})) {
			if (value !== null && value !== undefined && value !== '') query.set(key, String(value));
		}
		const search = query.toString();
		return `${this.baseUrl}/api/v1/${path}${search ? `?${search}` : ''}`;
	}
}
