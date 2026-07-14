/** Fetch-only OpenRouter API client. No SDK, persistence, or Node transport. */

export type QueryValue = string | number | boolean | undefined;
export type Query = Record<string, QueryValue>;
export type JsonRecord = Record<string, unknown>;

export interface ErrorPayload {
  error?: {
    code?: number | string;
    message?: string;
    metadata?: Record<string, unknown>;
  };
}

export interface ChatRequest extends JsonRecord {
  messages?: unknown[];
  prompt?: string;
  model?: string;
  models?: string[];
  stream?: boolean;
}

export interface ChatChoice extends JsonRecord {
  finish_reason?: string | null;
  native_finish_reason?: string | null;
  message?: {
    role?: string;
    content?: string | null;
    tool_calls?: unknown[];
  };
  delta?: {
    role?: string;
    content?: string | null;
    tool_calls?: unknown[];
  };
  error?: ErrorPayload["error"];
}

export interface ChatResponse extends JsonRecord {
  id?: string;
  model?: string;
  object?: string;
  choices?: ChatChoice[];
  usage?: Record<string, unknown>;
  error?: ErrorPayload["error"];
}

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  httpReferer?: string;
  appTitle?: string;
  appCategories?: string;
  fetch?: typeof fetch;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public metadata?: Record<string, unknown>,
    public retryAfter?: number,
  ) {
    super(`[${status}] ${message}`);
    this.name = "ApiError";
  }

  get errorType(): string | undefined {
    const value = this.metadata?.error_type;
    return typeof value === "string" ? value : undefined;
  }
}

export interface StreamResult {
  chunks: ChatResponse[];
  usage?: Record<string, unknown>;
  generationId?: string;
}

export class OpenRouterClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly attribution: Record<string, string>;

  constructor(opts: ClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
    this.fetchFn = opts.fetch ?? fetch;
    this.attribution = {};
    if (opts.httpReferer) this.attribution["HTTP-Referer"] = opts.httpReferer;
    if (opts.appTitle) this.attribution["X-OpenRouter-Title"] = opts.appTitle;
    if (opts.appCategories) this.attribution["X-OpenRouter-Categories"] = opts.appCategories;
  }

  models(query: Query = {}, eligible = false): Promise<{ data?: unknown[] } & JsonRecord> {
    return this.get(eligible ? "/models/user" : "/models", query);
  }

  model(model: string): Promise<JsonRecord> {
    const [author, ...slugParts] = model.split("/");
    const slug = slugParts.join("/");
    if (!author || !slug) throw new ApiError(400, `Bad model slug "${model}"; expected author/slug`);
    return this.get(`/model/${encodeURIComponent(author)}/${encodeURIComponent(slug)}`);
  }

  modelEndpoints(model: string): Promise<JsonRecord> {
    const [author, ...slugParts] = model.split("/");
    const slug = slugParts.join("/");
    if (!author || !slug) throw new ApiError(400, `Bad model slug "${model}"; expected author/slug`);
    return this.get(`/models/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/endpoints`);
  }

  providers(): Promise<{ data?: unknown[] } & JsonRecord> {
    return this.get("/providers");
  }

  key(): Promise<JsonRecord> {
    return this.get("/key");
  }

  generation(id: string): Promise<JsonRecord> {
    return this.get("/generation", { id });
  }

  chat(request: ChatRequest): Promise<ChatResponse> {
    return this.requestJson("POST", "/chat/completions", undefined, {
      ...request,
      stream: false,
    });
  }

  async streamChat(
    request: ChatRequest,
    onChunk?: (chunk: ChatResponse) => void,
  ): Promise<StreamResult> {
    const response = await this.fetchResponse("POST", "/chat/completions", undefined, {
      ...request,
      stream: true,
    });
    if (!response.ok) throw await errorFromResponse(response);
    if (!response.body) throw new ApiError(502, "OpenRouter returned an empty SSE response body");

    const chunks: ChatResponse[] = [];
    let usage: Record<string, unknown> | undefined;
    for await (const data of sseData(response.body)) {
      if (data === "[DONE]") break;
      let chunk: ChatResponse;
      try {
        chunk = JSON.parse(data) as ChatResponse;
      } catch {
        throw new ApiError(502, `OpenRouter returned malformed SSE data: ${data.slice(0, 160)}`);
      }
      if (chunk.error) throw errorFromPayload(chunk, 200);
      const choiceError = chunk.choices?.find((choice) => choice.error)?.error;
      if (choiceError) throw errorFromPayload({ error: choiceError }, 200);
      if (chunk.usage) usage = chunk.usage;
      chunks.push(chunk);
      onChunk?.(chunk);
    }
    return {
      chunks,
      usage,
      generationId: response.headers.get("X-Generation-Id") ?? undefined,
    };
  }

  private async get<T extends JsonRecord>(path: string, query: Query = {}): Promise<T> {
    let response = await this.fetchResponse("GET", path, query);
    if (response.status === 429 || response.status === 503) {
      const retryAfter = numericRetryAfter(response);
      if (retryAfter !== undefined && retryAfter >= 0 && retryAfter <= 15) {
        if (retryAfter > 0) await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        response = await this.fetchResponse("GET", path, query);
      }
    }
    if (!response.ok) throw await errorFromResponse(response);
    return (await response.json()) as T;
  }

  private async requestJson<T extends JsonRecord>(
    method: "POST",
    path: string,
    query: Query | undefined,
    body: JsonRecord,
  ): Promise<T> {
    const response = await this.fetchResponse(method, path, query, body);
    if (!response.ok) throw await errorFromResponse(response);
    const json = (await response.json()) as T & ErrorPayload;
    if (json.error) throw errorFromPayload(json, response.status);
    return json;
  }

  private fetchResponse(
    method: "GET" | "POST",
    path: string,
    query: Query = {},
    body?: JsonRecord,
  ): Promise<Response> {
    const url = new URL(`${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return this.fetchFn(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: body ? "text/event-stream, application/json" : "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...this.attribution,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
}

async function errorFromResponse(response: Response): Promise<ApiError> {
  const text = await response.text();
  let payload: ErrorPayload = {};
  try {
    payload = JSON.parse(text) as ErrorPayload;
  } catch {
    // Keep the raw body as the fallback message below.
  }
  const message = payload.error?.message || text || response.statusText;
  return new ApiError(
    response.status,
    message,
    payload.error?.metadata,
    numericRetryAfter(response),
  );
}

function errorFromPayload(payload: ErrorPayload, fallbackStatus: number): ApiError {
  const rawCode = payload.error?.code;
  const status = typeof rawCode === "number" ? rawCode : fallbackStatus;
  return new ApiError(status, payload.error?.message || "OpenRouter request failed", payload.error?.metadata);
}

function numericRetryAfter(response: Response): number | undefined {
  const raw = response.headers.get("Retry-After");
  if (raw === null) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds : undefined;
}

/** Parse SSE frames, ignoring comment heartbeats and joining multi-line data fields. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) yield data;
      }
      if (done) break;
    }
    const data = buffer
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data) yield data;
  } finally {
    reader.releaseLock();
  }
}
