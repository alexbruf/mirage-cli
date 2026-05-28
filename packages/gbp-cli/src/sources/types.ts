// Domain-level data-source contract. Windsor implements it today; a direct
// Google Business Profile Performance API source can drop in later behind the
// same interface without touching the CLI or formatters.

export interface Business {
  /** Stable id, e.g. "locations/1234567890". */
  id: string;
  /** Human-readable name, e.g. "Acme Roofing". */
  name: string;
  [key: string]: unknown;
}

export interface DateRange {
  /** Windsor-style preset, e.g. "last_30d". Used when `from` is absent. */
  preset?: string;
  /** Explicit start date, YYYY-MM-DD. */
  from?: string;
  /** Explicit end date, YYYY-MM-DD. Defaults to today when omitted. */
  to?: string;
}

export interface QueryOpts {
  /** Business name, id, or "all" (default). */
  business?: string;
  range: DateRange;
  /** Cap on rows returned. */
  maxRows?: number;
}

export type Row = Record<string, unknown>;

export interface DataSource {
  readonly name: string;
  listBusinesses(): Promise<Business[]>;
  metrics(opts: QueryOpts): Promise<Row[]>;
  reviews(opts: QueryOpts): Promise<Row[]>;
  keywords(opts: QueryOpts): Promise<Row[]>;
  /** Escape hatch: request arbitrary connector fields. */
  raw(fields: string[], opts: QueryOpts): Promise<Row[]>;
}
