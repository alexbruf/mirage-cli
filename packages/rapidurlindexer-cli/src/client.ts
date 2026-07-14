/**
 * Typed, fetch-only client for the Rapid URL Indexer REST API.
 *
 * Official API reference: https://rapidurlindexer.com/indexing-api/
 */

export const DEFAULT_BASE_URL = "https://rapidurlindexer.com/wp-json";
export const MAX_PROJECT_URLS = 9_999;

export type ProjectStatus =
  | "pending"
  | "submitted"
  | "completed"
  | "failed"
  | "refunded";

export interface ProjectSummary {
  id: number;
  name: string;
  status: ProjectStatus;
  submitted_urls: number;
  indexed_urls: number;
  created_at: string;
}

export interface ListProjectsResponse {
  success: boolean;
  projects: ProjectSummary[];
}

export interface CreateProjectInput {
  project_name: string;
  urls: string[];
  notify_on_status_change?: boolean;
  apex_mode_enabled?: boolean;
}

export interface CreateProjectResponse {
  message: string;
  project_id: number;
}

export interface ProjectDetails {
  project_id: number;
  project_name: string;
  status: ProjectStatus;
  urls: string[];
  submitted_links: number;
  indexed_links: number;
  created_at: string;
  updated_at: string;
}

export type ReportUrlStatus = "indexed" | "not_indexed";

export interface ProjectReportUrl {
  url: string;
  status: ReportUrlStatus;
}

export interface ProjectReport {
  project_id: number;
  project_name: string;
  total_urls: number;
  urls: ProjectReportUrl[];
}

export interface CreditBalance {
  credits: number;
}

export type ApiErrorKind =
  | "authentication"
  | "forbidden"
  | "not_ready"
  | "rate_limited"
  | "bad_request"
  | "not_found"
  | "server"
  | "api";

export class RapidUrlIndexerApiError extends Error {
  override readonly name = "RapidUrlIndexerApiError";

  constructor(
    public readonly status: number,
    message: string,
    public readonly body: unknown,
    public readonly kind: ApiErrorKind,
    public readonly hint?: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(`[${status}] ${message}`);
  }
}

export interface RapidUrlIndexerClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Injectable for tests and runtimes that provide their own fetch. */
  fetch?: typeof globalThis.fetch;
}

export class RapidUrlIndexerClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: RapidUrlIndexerClientOptions) {
    const apiKey = options.apiKey.trim();
    if (!apiKey) throw new Error("Rapid URL Indexer API key cannot be empty.");
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch
      ?? ((input, init) => globalThis.fetch(input, init)) as typeof globalThis.fetch;
  }

  getCreditBalance(): Promise<CreditBalance> {
    return this.request<CreditBalance>("/api/v1/credits/balance");
  }

  listProjects(): Promise<ListProjectsResponse> {
    return this.request<ListProjectsResponse>("/api/v1/projects/list");
  }

  createProject(input: CreateProjectInput): Promise<CreateProjectResponse> {
    validateCreateProjectInput(input);
    return this.request<CreateProjectResponse>("/api/v1/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  getProject(projectId: number): Promise<ProjectDetails> {
    return this.request<ProjectDetails>(`/api/v1/projects/${validateProjectId(projectId)}`);
  }

  getProjectReport(projectId: number, format?: "json"): Promise<ProjectReport>;
  getProjectReport(projectId: number, format: "csv"): Promise<string>;
  getProjectReport(
    projectId: number,
    format: "json" | "csv" = "json",
  ): Promise<ProjectReport | string> {
    const id = validateProjectId(projectId);
    return this.request<ProjectReport | string>(`/api/v1/projects/${id}/report`, {
      headers: { Accept: format === "csv" ? "text/csv" : "application/json" },
      responseType: format,
    });
  }

  private async request<T>(
    path: string,
    init: RequestInit & { responseType?: "json" | "csv" } = {},
  ): Promise<T> {
    const { responseType = "json", headers, ...requestInit } = init;
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...requestInit,
      headers: {
        "X-API-Key": this.apiKey,
        Accept: responseType === "csv" ? "text/csv" : "application/json",
        ...headers,
      },
    });

    if (!response.ok) throw await errorFromResponse(response);
    if (responseType === "csv") return (await response.text()) as T;

    const text = await response.text();
    if (!text) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new RapidUrlIndexerApiError(
        response.status,
        "API returned a non-JSON success response",
        text,
        "api",
        "retry the request or request the report with CSV output",
      );
    }
  }
}

function validateProjectId(projectId: number): number {
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    throw new Error("project id must be a positive integer");
  }
  return projectId;
}

function validateCreateProjectInput(input: CreateProjectInput): void {
  const name = input.project_name.trim();
  if (!name || name.length > 255) {
    throw new Error("project_name must contain 1 to 255 characters");
  }
  if (!Array.isArray(input.urls) || input.urls.length === 0) {
    throw new Error("urls must contain at least one URL");
  }
  if (input.urls.length > MAX_PROJECT_URLS) {
    throw new Error(`urls cannot contain more than ${MAX_PROJECT_URLS} entries`);
  }
  for (const value of input.urls) validatePublicHttpUrl(value);
}

export function validatePublicHttpUrl(value: string): void {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Invalid URL: ${JSON.stringify(value)}`);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
    throw new Error(`URL must use http:// or https://: ${JSON.stringify(value)}`);
  }
  if (url.username || url.password) {
    throw new Error(`URL must not contain embedded credentials: ${JSON.stringify(value)}`);
  }
}

async function errorFromResponse(response: Response): Promise<RapidUrlIndexerApiError> {
  const text = await response.text();
  let body: unknown = text;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // Keep plain-text bodies intact for diagnostics.
    }
  }

  const message = extractMessage(body) || response.statusText || "Rapid URL Indexer API error";
  const lower = message.toLowerCase();
  const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));

  let kind: ApiErrorKind = "api";
  let hint: string | undefined;
  if (response.status === 401 || (response.status === 403 && /api[ _-]?key|auth/.test(lower))) {
    kind = "authentication";
    hint = "check RAPIDURLINDEXER_API_KEY or pass --api-key";
  } else if (response.status === 403) {
    kind = "forbidden";
    hint = /credit/.test(lower)
      ? "check the account credit balance before creating a project"
      : "the API key does not have permission for this request";
  } else if (response.status === 425) {
    kind = "not_ready";
    hint = "reports normally become available 96 hours after project creation";
  } else if (response.status === 429) {
    kind = "rate_limited";
    hint = retryAfterSeconds === undefined
      ? "rate limited at 100 requests/minute; retry later"
      : `rate limited; retry after ${retryAfterSeconds}s`;
  } else if (response.status === 400) {
    kind = "bad_request";
  } else if (response.status === 404) {
    kind = "not_found";
  } else if (response.status >= 500) {
    kind = "server";
  }

  return new RapidUrlIndexerApiError(
    response.status,
    message,
    body,
    kind,
    hint,
    retryAfterSeconds,
  );
}

function extractMessage(body: unknown): string {
  if (typeof body === "string") return body;
  if (!body || typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  if (typeof record.error === "string") return record.error;
  if (record.error && typeof record.error === "object") {
    const nested = record.error as Record<string, unknown>;
    if (typeof nested.message === "string") return nested.message;
  }
  return "";
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1_000));
}
