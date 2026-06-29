// Local Falcon REST API backend. Docs: https://docs.localfalcon.com/
// (OpenAPI: https://docs.localfalcon.com/openapi.yaml)
//
// Auth: the API key is sent as the `api_key` form field on every POST (the
// API also accepts it as a query param or a Bearer header). Every endpoint is
// POST + application/x-www-form-urlencoded. Fetch-only, so it runs in workerd.
//
// Response envelope (verified live): `{ code, success, message, data }`, where
// list payloads are `data.<collection>` (data.locations, data.reports) with
// `total` / `count` / `next_token` alongside. We unwrap `data` and pull the
// collection key.
import type {
  DataSource,
  KeywordsFilter,
  LocationsFilter,
  ReportsFilter,
  Row,
  RunScanInput,
} from "./types.ts";

const BASE = "https://api.localfalcon.com";

export class LocalFalconSource implements DataSource {
  readonly name = "localfalcon";

  constructor(private readonly apiKey: string) {}

  async locations(opts: LocationsFilter): Promise<Row[]> {
    const json = await this.post("/v1/locations/", {
      query: opts.query,
      limit: opts.limit,
    });
    return collection(json, "locations");
  }

  async reports(opts: ReportsFilter): Promise<Row[]> {
    const json = await this.post("/v1/reports/", {
      place_id: opts.placeId,
      keyword: opts.keyword,
      grid_size: opts.gridSize,
      start_date: opts.startDate,
      end_date: opts.endDate,
      platform: opts.platform,
      limit: opts.limit,
    });
    return collection(json, "reports");
  }

  async report(reportKey: string): Promise<Row> {
    const json = await this.post(`/v1/reports/${encodeURIComponent(reportKey)}/`, {});
    return unwrap(json) as Row;
  }

  async keywords(opts: KeywordsFilter): Promise<Row[]> {
    const json = await this.post("/v1/keyword-reports/", {
      keyword: opts.keyword,
      start_date: opts.startDate,
      end_date: opts.endDate,
      limit: opts.limit,
    });
    return collection(json, "reports");
  }

  async runScan(input: RunScanInput): Promise<Row> {
    const json = await this.post("/v2/run-scan/", {
      place_id: input.placeId,
      lat: input.lat,
      lng: input.lng,
      keyword: input.keyword,
      grid_size: input.gridSize,
      radius: input.radius,
      measurement: input.measurement ?? "mi",
      platform: input.platform,
    });
    return unwrap(json) as Row;
  }

  private async post(path: string, params: Record<string, unknown>): Promise<any> {
    const body = new URLSearchParams();
    body.set("api_key", this.apiKey);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") body.set(k, String(v));
    }
    const url = path.startsWith("http") ? path : `${BASE}${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "localfalcon-cli/0.1",
      },
      body,
    });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Local Falcon returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    // Envelope (verified live): { code: number, success: boolean, message:
    // string|false, data: ... }. Treat a non-2xx HTTP, success:false, or a
    // >=400 body code as an error; `message` carries the reason on failure.
    const failed =
      !res.ok ||
      json?.success === false ||
      (typeof json?.code === "number" && json.code >= 400) ||
      Boolean(json?.error);
    if (failed) {
      const msg =
        (typeof json?.message === "string" && json.message) ||
        json?.error?.message ||
        json?.error ||
        `HTTP ${res.status}`;
      throw new Error(`Local Falcon API error: ${msg}`);
    }
    return json;
  }
}

/** Unwrap the `{ status, code, data }` envelope to the payload. */
function unwrap(json: any): unknown {
  return json?.data ?? json;
}

/** Pull a named collection out of the payload, tolerating a few shapes. */
function collection(json: any, key: string): Row[] {
  const data = unwrap(json) as any;
  const arr = Array.isArray(data) ? data : (data?.[key] ?? data?.results ?? data?.items ?? []);
  return (Array.isArray(arr) ? arr : []) as Row[];
}
