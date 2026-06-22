export interface ClientConfig {
	baseUrl: string;
	token: string;
	orgId?: string;
}

export interface ListResponse<T> {
	rows: T[];
	total: number;
	page: number;
	limit: number;
}

export interface DetailResponse<T> {
	row: T;
}

export class ApiClient {
	constructor(private config: ClientConfig) {}

	async list<T = Record<string, unknown>>(
		path: string,
		params: Record<string, string | undefined> = {},
	): Promise<ListResponse<T>> {
		const qs = new URLSearchParams(
			Object.entries(params).filter((e): e is [string, string] => e[1] != null && e[1] !== ''),
		).toString();
		return this.request(`/api/v1/${path}${qs ? `?${qs}` : ''}`, { method: 'GET' });
	}

	async get<T = Record<string, unknown>>(path: string): Promise<T> {
		const data = await this.request<DetailResponse<T>>(`/api/v1/${path}`, { method: 'GET' });
		return data.row;
	}

	async post<T = Record<string, unknown>>(path: string, body?: Record<string, unknown>): Promise<T> {
		return this.request(`/api/v1/${path}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: body ? JSON.stringify(body) : undefined,
		});
	}

	async del<T = Record<string, unknown>>(path: string): Promise<T> {
		return this.request(`/api/v1/${path}`, { method: 'DELETE' });
	}

	async raw<T = unknown>(absolutePath: string): Promise<T> {
		return this.request(absolutePath, { method: 'GET' });
	}

	private async request<T>(path: string, init: RequestInit): Promise<T> {
		const res = await fetch(`${this.config.baseUrl}${path}`, {
			...init,
			headers: { ...this.headers(), ...(init.headers as Record<string, string> | undefined) },
		});
		if (!res.ok) {
			throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
		}
		return res.json() as Promise<T>;
	}

	private headers(): Record<string, string> {
		const h: Record<string, string> = { Authorization: `Bearer ${this.config.token}` };
		if (this.config.orgId) h['X-Organization-Id'] = this.config.orgId;
		return h;
	}
}
