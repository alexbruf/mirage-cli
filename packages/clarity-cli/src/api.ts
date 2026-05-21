import type { ClarityFilters, SortBy, InsightsDimension } from "./types.ts";
import { getToken } from "./config.ts";

const MCP_BASE = "https://clarity.microsoft.com/mcp";
const DASHBOARD_URL = `${MCP_BASE}/dashboard/query`;
const RECORDINGS_URL = `${MCP_BASE}/recordings/sample`;
const DOCUMENTATION_URL = `${MCP_BASE}/documentation/query`;
const INSIGHTS_URL = "https://www.clarity.ms/export-data/api/v1/project-live-insights";

const SORT_ENUM: Record<SortBy, number> = {
  SessionStart_DESC: 0,
  SessionStart_ASC: 1,
  SessionDuration_ASC: 2,
  SessionDuration_DESC: 3,
  SessionClickCount_ASC: 4,
  SessionClickCount_DESC: 5,
  PageCount_ASC: 6,
  PageCount_DESC: 7,
};

function requireToken(override?: string): string {
  const token = override || getToken();
  if (token) return token;
  console.error(
    "No Clarity API token configured.\n" +
    "Run: clarity auth <your-token>\n" +
    "Or set CLARITY_API_TOKEN env var, or pass --token <token>.\n" +
    "Generate a token at: Clarity project → Settings → Data Export.",
  );
  process.exit(1);
}

async function post(url: string, body: unknown, token: string): Promise<any> {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${text.slice(0, 500)}`);
  }
  const ct = resp.headers.get("content-type") || "";
  return ct.includes("application/json") ? resp.json() : resp.text();
}

async function getJson(url: string, token: string): Promise<any> {
  const resp = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${text.slice(0, 500)}`);
  }
  return resp.json();
}

export async function askDashboard(query: string, tokenOverride?: string): Promise<any> {
  const token = requireToken(tokenOverride);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return post(DASHBOARD_URL, { query, timezone }, token);
}

export async function listRecordings(
  filters: ClarityFilters,
  sortBy: SortBy,
  count: number,
  tokenOverride?: string,
): Promise<any> {
  const token = requireToken(tokenOverride);
  return post(
    RECORDINGS_URL,
    {
      sortBy: SORT_ENUM[sortBy],
      start: filters.date.start,
      end: filters.date.end,
      filters,
      count,
    },
    token,
  );
}

export async function queryDocs(query: string, tokenOverride?: string): Promise<any> {
  const token = requireToken(tokenOverride);
  return post(DOCUMENTATION_URL, { query }, token);
}

export async function projectLiveInsights(
  numOfDays: 1 | 2 | 3,
  dims: InsightsDimension[],
  tokenOverride?: string,
): Promise<any> {
  const token = requireToken(tokenOverride);
  const params = new URLSearchParams();
  params.set("numOfDays", String(numOfDays));
  dims.slice(0, 3).forEach((d, i) => params.set(`dimension${i + 1}`, d));
  return getJson(`${INSIGHTS_URL}?${params}`, token);
}
