// Windsor.ai Connectors REST API backend for the google_my_business connector.
// Docs: https://windsor.ai/api-documentation/
import type { Business, DataSource, DateRange, QueryOpts, Row } from "./types.ts";

const BASE = "https://connectors.windsor.ai";
const ACCOUNTS = "https://onboard.windsor.ai/api/common/ds-accounts";
const CONNECTOR = "google_my_business";

const METRIC_FIELDS = [
  "date",
  "location_title",
  "location_id",
  "impressions",
  "call_clicks",
  "website_clicks",
  "direction_requests",
  "business_bookings",
];

const REVIEW_FIELDS = [
  "location_title",
  "review_create_time",
  "review_star_rating",
  "review_reviewer",
  "review_comment",
  "review_reply_comment",
];

const KEYWORD_FIELDS = ["location_title", "search_keyword", "search_keyword_value"];

export class WindsorSource implements DataSource {
  readonly name = "windsor";

  constructor(private readonly apiKey: string) {}

  async listBusinesses(): Promise<Business[]> {
    // Primary: the purpose-built accounts endpoint (each GBP location is an account).
    try {
      const res = await this.get(ACCOUNTS, { datasource: CONNECTOR });
      const arr: any[] = Array.isArray(res) ? res : (res.data ?? []);
      const mapped = arr
        .filter((r) => r.account_id)
        .map((r) => ({ id: r.account_id as string, name: (r.account_name ?? r.account_id) as string }));
      if (mapped.length) return mapped;
    } catch {
      // fall through to deriving from data
    }
    // Fallback: distinct locations that have data in the last 2 years.
    const data = await this.query(["location_id", "location_title"], { range: { preset: "last_2years" } });
    const seen = new Map<string, string>();
    for (const r of data) {
      const id = r.location_id as string | undefined;
      if (id) seen.set(id, (r.location_title as string) ?? id);
    }
    return [...seen].map(([id, name]) => ({ id, name }));
  }

  metrics(opts: QueryOpts): Promise<Row[]> {
    return this.query(METRIC_FIELDS, opts);
  }

  reviews(opts: QueryOpts): Promise<Row[]> {
    return this.query(REVIEW_FIELDS, opts);
  }

  keywords(opts: QueryOpts): Promise<Row[]> {
    return this.query(KEYWORD_FIELDS, opts);
  }

  raw(fields: string[], opts: QueryOpts): Promise<Row[]> {
    return this.query(fields, opts);
  }

  /** List every field the connector exposes (Windsor-specific helper). */
  async listFields(): Promise<Row[]> {
    const res = await this.get(`${BASE}/${CONNECTOR}/fields`, {});
    return (Array.isArray(res) ? res : (res.data ?? res.result ?? [])) as Row[];
  }

  private async query(fields: string[], opts: QueryOpts): Promise<Row[]> {
    const params: Record<string, string> = {
      fields: fields.join(","),
      _renderer: "json",
      ...rangeParams(opts.range),
    };
    const filter = businessFilter(opts.business);
    if (filter) params.filter = filter;
    if (opts.maxRows) params._max_rows = String(opts.maxRows);

    const res = await this.get(`${BASE}/${CONNECTOR}`, params);
    return (res.data ?? []) as Row[];
  }

  private async get(path: string, params: Record<string, string>): Promise<any> {
    const url = new URL(path);
    url.searchParams.set("api_key", this.apiKey);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetch(url, { headers: { "User-Agent": "gbp-cli/0.1" } });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Windsor returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok || json?.error) {
      const msg = json?.error?.message ?? json?.error ?? `HTTP ${res.status}`;
      throw new Error(`Windsor API error: ${msg}`);
    }
    return json;
  }
}

function rangeParams(range: DateRange): Record<string, string> {
  if (range.from) {
    const p: Record<string, string> = { date_from: range.from };
    if (range.to) p.date_to = range.to;
    return p;
  }
  return { date_preset: range.preset ?? "last_30d" };
}

function businessFilter(business?: string): string | undefined {
  if (!business || business === "all") return undefined;
  const field = business.startsWith("locations/") ? "location_id" : "location_title";
  return JSON.stringify([[field, "eq", business]]);
}
