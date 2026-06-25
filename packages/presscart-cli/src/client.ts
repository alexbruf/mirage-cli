import type { Session } from "./config.ts";

export interface RequestOptions {
  method?: string;
  body?: BodyInit;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(`[${status}] ${message}`);
    this.name = "ApiError";
  }
}

export class ApiClient {
  constructor(private session: Session) {}

  async request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
    const res = await this.fetch(path, opts);
    if (!res.ok) throw await errorFromResponse(res);
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) return (await res.json()) as T;
    return (await res.text()) as unknown as T;
  }

  async requestRaw(path: string, opts: RequestOptions = {}): Promise<Response> {
    const res = await this.fetch(path, opts);
    if (!res.ok) throw await errorFromResponse(res);
    return res;
  }

  private async fetch(path: string, opts: RequestOptions): Promise<Response> {
    const url = this.buildUrl(path, opts.query);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.session.token}`,
      Accept: "application/json",
      ...opts.headers,
    };
    return fetch(url, {
      method: opts.method ?? "GET",
      body: opts.body,
      headers,
    });
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): string {
    const base = this.session.baseUrl.replace(/\/$/, "");
    const suffix = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${base}${suffix}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  /** Convenience JSON POST/PUT/PATCH. */
  async json<T = unknown>(
    method: "POST" | "PUT" | "PATCH",
    path: string,
    body: unknown,
  ): Promise<T> {
    return this.request<T>(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /**
   * Multipart/form-data upload. Deliberately does NOT set a Content-Type header
   * so `fetch` derives the `multipart/form-data; boundary=...` value from the
   * FormData body. Setting it by hand would omit the boundary and break parsing.
   */
  async multipart<T = unknown>(
    method: "POST" | "PUT" | "PATCH",
    path: string,
    form: FormData,
  ): Promise<T> {
    return this.request<T>(path, { method, body: form });
  }
}

async function errorFromResponse(res: Response): Promise<ApiError> {
  const text = await res.text();
  let message: string;
  try {
    const json = JSON.parse(text) as {
      message?: unknown;
      error?: unknown;
      errors?: unknown;
    };
    message = extractMessage(json) ?? text;
  } catch {
    message = text || res.statusText;
  }
  return new ApiError(res.status, message);
}

function extractMessage(json: { message?: unknown; error?: unknown; errors?: unknown }): string | null {
  if (typeof json.message === "string") return json.message;
  if (typeof json.error === "string") return json.error;
  // Presscart Zod-shape: { success: false, error: { issues: [{path, message}], name: "ZodError" } }
  const err = json.error;
  if (err && typeof err === "object") {
    const issues = (err as { issues?: unknown }).issues;
    if (Array.isArray(issues)) {
      const parts = issues
        .map((i) => {
          const issue = i as { path?: unknown[]; message?: string };
          const path = Array.isArray(issue.path) ? issue.path.join(".") : "";
          return path ? `${path}: ${issue.message}` : (issue.message ?? "");
        })
        .filter(Boolean);
      if (parts.length > 0) return `${(err as { name?: string }).name ?? "validation"}: ${parts.join("; ")}`;
    }
    const nested = (err as { message?: unknown }).message;
    if (typeof nested === "string") return nested;
  }
  // Some endpoints return { errors: [{ message }] } or { errors: { field: [...] } }
  const errs = json.errors;
  if (Array.isArray(errs)) {
    const parts = errs
      .map((e) => (typeof e === "string" ? e : (e as { message?: string }).message))
      .filter(Boolean);
    if (parts.length > 0) return parts.join("; ");
  }
  return null;
}
