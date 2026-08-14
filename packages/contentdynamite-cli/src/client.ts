export const DEFAULT_BASE_URL = "https://api.dynamate.ai";

export type ApiErrorKind =
  | "authentication"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation"
  | "rate_limited"
  | "server"
  | "api";

export class ContentDynamiteApiError extends Error {
  override readonly name = "ContentDynamiteApiError";

  constructor(
    public readonly status: number,
    message: string,
    public readonly body: unknown,
    public readonly kind: ApiErrorKind,
    public readonly hint?: string,
  ) {
    super(`[${status}] ${message}`);
  }
}

export interface ContentDynamiteClientOptions {
  token: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export class ContentDynamiteClient {
  readonly token: string;
  readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: ContentDynamiteClientOptions) {
    const token = options.token.trim();
    if (!token) throw new Error("Content Dynamite API token cannot be empty.");
    this.token = token;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch
      ?? ((input, init) => globalThis.fetch(input, init)) as typeof globalThis.fetch;
  }

  get<T>(path: string, params?: QueryParams): Promise<T> {
    return this.request<T>(path, { params });
  }

  getText(path: string, params?: QueryParams): Promise<string> {
    return this.request<string>(path, { params, responseType: "text" });
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "DELETE" });
  }

  postForm<T>(
    path: string,
    filename: string,
    content: Uint8Array,
    contentType: string | null,
    params?: QueryParams,
  ): Promise<T> {
    const form = new FormData();
    const blob = contentType
      ? new Blob([content as BlobPart], { type: contentType })
      : new Blob([content as BlobPart]);
    form.append("file", blob, filename);
    return this.request<T>(path, { method: "POST", body: form, params });
  }

  private url(path: string, params?: QueryParams): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value === null || value === undefined || value === "") continue;
      query.set(key, String(value));
    }
    const encoded = query.toString();
    const suffix = encoded ? `?${encoded}` : "";
    return `${this.baseUrl}/api/v1/${path}${suffix}`;
  }

  private async request<T>(
    path: string,
    init: RequestInit & { params?: QueryParams; responseType?: "json" | "text" } = {},
  ): Promise<T> {
    const { params, responseType = "json", headers, ...requestInit } = init;
    const response = await this.fetchImpl(this.url(path, params), {
      ...requestInit,
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...headers,
      },
    });

    if (response.status >= 300 && response.status < 400) {
      throw new ContentDynamiteApiError(
        response.status,
        "the API redirected this request",
        null,
        "api",
        "the client never follows redirects so multipart bodies are not resent, check the base URL",
      );
    }
    if (!response.ok) throw await errorFromResponse(response);
    if (responseType === "text") return (await response.text()) as T;

    const text = await response.text();
    if (!text) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ContentDynamiteApiError(
        response.status,
        "API returned a non JSON success response",
        text,
        "api",
      );
    }
  }
}

async function errorFromResponse(response: Response): Promise<ContentDynamiteApiError> {
  const text = await response.text();
  let body: unknown = text;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  const message = extractDetail(body) || text || response.statusText || "Content Dynamite API error";

  let kind: ApiErrorKind = "api";
  let hint: string | undefined;
  if (response.status === 401) {
    kind = "authentication";
    hint = "check VE_DYNAMITE_TOKEN or pass --token, the token may be revoked or expired";
  } else if (response.status === 403) {
    kind = "forbidden";
    hint = "the token does not have permission for this request";
  } else if (response.status === 404) {
    kind = "not_found";
  } else if (response.status === 409) {
    kind = "conflict";
    hint = "the resource is still generating or the name is already taken, retry once it settles";
  } else if (response.status === 422) {
    kind = "validation";
  } else if (response.status === 429) {
    kind = "rate_limited";
    hint = "retry later";
  } else if (response.status >= 500) {
    kind = "server";
  }

  return new ContentDynamiteApiError(response.status, message, body, kind, hint);
}

function extractDetail(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const detail = (body as Record<string, unknown>).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((entry) => {
        if (!entry || typeof entry !== "object") return String(entry);
        const record = entry as Record<string, unknown>;
        const loc = Array.isArray(record.loc)
          ? record.loc.slice(1).map((part) => String(part)).join(".")
          : "";
        const msg = typeof record.msg === "string" ? record.msg : JSON.stringify(record);
        return loc ? `${loc}: ${msg}` : msg;
      })
      .join("; ");
  }
  return "";
}
