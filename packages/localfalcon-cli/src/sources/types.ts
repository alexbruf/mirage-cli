// Domain-level data-source contract for Local Falcon. The HTTP backend
// (LocalFalconSource) implements it today; a mock or an alternate transport
// can drop in behind the same interface without touching the CLI or formatters.

export type Row = Record<string, unknown>;

export interface ReportsFilter {
  placeId?: string;
  keyword?: string;
  gridSize?: string;
  startDate?: string;
  endDate?: string;
  platform?: string;
  limit?: number;
}

export interface KeywordsFilter {
  keyword?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export interface LocationsFilter {
  query?: string;
  limit?: number;
}

export interface RunScanInput {
  /** A saved/known Google place id. Either placeId OR lat+lng is required. */
  placeId?: string;
  lat?: number;
  lng?: number;
  /** The search term to scan for. Required. */
  keyword: string;
  /** Grid dimension, e.g. "7" for a 7x7 grid. */
  gridSize?: string;
  /** Radius in miles between grid points. */
  radius?: string;
  /** "google" (default) or an AI platform the account supports. */
  platform?: string;
}

export interface DataSource {
  readonly name: string;
  /** Connected/saved locations (place_id, name, address, lat, lng, rating, reviews). */
  locations(opts: LocationsFilter): Promise<Row[]>;
  /** Existing scan reports (report_key, arp, atrp, solv, image, date, location...). */
  reports(opts: ReportsFilter): Promise<Row[]>;
  /** One scan report by key, with the full ARP/ATRP/SoLV + image/heatmap/pdf payload. */
  report(reportKey: string): Promise<Row>;
  /** Keyword-level rollups (avg_arp, avg_atrp, avg_solv across locations). */
  keywords(opts: KeywordsFilter): Promise<Row[]>;
  /** Run a NEW grid scan. Billable: consumes Local Falcon scan credits. */
  runScan(input: RunScanInput): Promise<Row>;
  /** Escape hatch: POST any API path with arbitrary form params. */
  raw(path: string, params: Record<string, string>): Promise<unknown>;
}
