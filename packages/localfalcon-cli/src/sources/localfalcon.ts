// Local Falcon REST API backend. Docs: https://docs.localfalcon.com/
// (OpenAPI: https://docs.localfalcon.com/openapi.yaml)
//
// Auth: the API key is sent as the `api_key` form field on every POST (the
// API also accepts it as a query param or a Bearer header). Every endpoint is
// POST + application/x-www-form-urlencoded. Fetch-only, so it runs in workerd.
//
// Response envelope: the API wraps payloads as `{ status, code, data }`. We
// unwrap `data` and pull the documented collection key (reports/locations).
// Shapes follow the documented API; verify against a live key when one exists.
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
      platform: input.platform,
    });
    return unwrap(json) as Row;
  }

  raw(path: string, params: Record<string, string>): Promise<unknown> {
    return this.post(path, params);
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
    const failed =
      !res.ok ||
      json?.error ||
      (typeof json?.status === "string" && json.status.toLowerCase() !== "success");
    if (failed) {
      const msg = json?.error?.message ?? json?.message ?? json?.error ?? `HTTP ${res.status}`;
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
