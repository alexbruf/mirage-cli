import { ApiClient } from "../client.ts";
import { requireSession } from "../config.ts";
import {
  type OutputOpts,
  rowPriceUsd,
  unwrapList,
  writeObject,
  writeOutput,
} from "../output.ts";

function client(): ApiClient {
  return new ApiClient(requireSession());
}

export interface ListOutletsOpts extends OutputOpts {
  limit?: number;
  page?: number;
  search?: string;
  country?: string;
  state?: string;
  city?: string;
  tag?: string;
  /** Follow pagination and return every page (capped for safety). */
  all?: boolean;
  /** Budget filters in whole USD, inclusive. */
  minPrice?: number;
  maxPrice?: number;
}

const PAGE_CAP = 100;
const CATALOG_PAGE_SIZE = 1000;

/**
 * Outlet listing price in whole USD. Preserve the legacy flat-field lookup for
 * callers that provide normalized records, then fall back to Presscart's real
 * API shape: the lowest whole-dollar `unit_amount` in `prices[]`.
 */
export function outletPriceUsd(rec: Record<string, unknown>): number | undefined {
  for (const k of ["unit_amount", "price", "amount", "cost", "unit_price"]) {
    const v = rec[k];
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
    if (Number.isFinite(n)) return n;
  }
  return rowPriceUsd(rec);
}

function numberOr(v: unknown, fallback: number | undefined): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

function budgetLabel(min?: number, max?: number): string {
  if (min !== undefined && max !== undefined) return `$${min}-$${max}`;
  if (max !== undefined) return `<= $${max}`;
  if (min !== undefined) return `>= $${min}`;
  return "";
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value.toLocaleLowerCase() : undefined;
}

function matchesTextFilters(record: Record<string, unknown>, opts: ListOutletsOpts): boolean {
  const search = text(opts.search);
  if (
    search !== undefined &&
    ![record.name, record.outlet_name, record.website_url].some((value) =>
      text(value)?.includes(search),
    )
  ) {
    return false;
  }

  for (const field of ["country", "state", "city"] as const) {
    const wanted = text(opts[field]);
    if (wanted !== undefined && text(record[field]) !== wanted) return false;
  }

  const wantedTag = text(opts.tag);
  if (wantedTag !== undefined) {
    const tags = record.tags;
    if (
      !Array.isArray(tags) ||
      !tags.some(
        (tag) =>
          tag &&
          typeof tag === "object" &&
          text((tag as Record<string, unknown>).name) === wantedTag,
      )
    ) {
      return false;
    }
  }

  return true;
}

function filterLabel(opts: ListOutletsOpts): string {
  const labels: string[] = [];
  if (opts.search !== undefined) labels.push(`"${opts.search}"`);
  if (opts.country !== undefined) labels.push(`country "${opts.country}"`);
  if (opts.state !== undefined) labels.push(`state "${opts.state}"`);
  if (opts.city !== undefined) labels.push(`city "${opts.city}"`);
  if (opts.tag !== undefined) labels.push(`tag "${opts.tag}"`);
  if (opts.minPrice !== undefined || opts.maxPrice !== undefined) {
    labels.push(budgetLabel(opts.minPrice, opts.maxPrice));
  }
  return labels.join(", ");
}

type OutletListClient = Pick<ApiClient, "request">;

export async function listOutlets(
  opts: ListOutletsOpts,
  api: OutletListClient = client(),
): Promise<void> {
  const hasBudget = opts.minPrice !== undefined || opts.maxPrice !== undefined;
  const hasClientFilter =
    hasBudget ||
    opts.search !== undefined ||
    opts.country !== undefined ||
    opts.state !== undefined ||
    opts.city !== undefined ||
    opts.tag !== undefined;
  const pageCatalog = opts.all === true || hasClientFilter;
  const baseQuery = { limit: pageCatalog ? CATALOG_PAGE_SIZE : opts.limit };

  let totalRecords: number | undefined;
  let totalPages = 1;

  const fetchPage = async (page: number): Promise<Record<string, unknown>[]> => {
    const res = await api.request<unknown>("/outlets", { query: { ...baseQuery, page } });
    if (res && typeof res === "object") {
      const obj = res as Record<string, unknown>;
      totalRecords = numberOr(obj.total_records, totalRecords);
      totalPages = numberOr(obj.total_pages, totalPages) ?? 1;
    }
    return unwrapList(res, ["outlets"]) as Record<string, unknown>[];
  };

  const records: Record<string, unknown>[] = [];
  const seenIds = new Set<string | number>();
  const appendPage = (pageRecords: Record<string, unknown>[]): void => {
    for (const record of pageRecords) {
      const id = record.id;
      if (typeof id === "string" || typeof id === "number") {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
      }
      records.push(record);
    }
  };

  appendPage(await fetchPage(pageCatalog ? 1 : (opts.page ?? 1)));
  if (pageCatalog) {
    for (let p = 2; p <= totalPages && p <= PAGE_CAP; p++) {
      appendPage(await fetchPage(p));
    }
    if (totalPages > PAGE_CAP) {
      process.stderr.write(`# warning: stopped at ${PAGE_CAP} pages (total_pages=${totalPages})\n`);
    }
  }

  const textMatches = records.filter((record) => matchesTextFilters(record, opts));
  let unpriced = 0;
  const matches = !hasBudget
    ? textMatches
    : textMatches.filter((record) => {
        const usd = outletPriceUsd(record);
        if (usd === undefined) {
          unpriced++;
          return false;
        }
        if (opts.minPrice !== undefined && usd < opts.minPrice) return false;
        if (opts.maxPrice !== undefined && usd > opts.maxPrice) return false;
        return true;
      });

  // A filtering command scans the catalog first, so --limit caps matches rather
  // than restricting what the client can inspect. --all continues to emit all
  // rows when no filter is active.
  const limitedMatches =
    hasClientFilter && opts.limit !== undefined
      ? matches.slice(0, Math.max(0, opts.limit))
      : matches;
  const rows = limitedMatches.map((record) => {
    const usd = outletPriceUsd(record);
    return usd === undefined
      ? record
      : { ...record, price_usd: `$${usd.toLocaleString("en-US")}` };
  });

  // Total-count summary to stderr so stdout stays clean for json/csv piping.
  const totalNote = totalRecords !== undefined ? ` of ${totalRecords} total` : "";
  const matchNote = hasClientFilter ? ` matching ${filterLabel(opts)}` : "";
  const countNote =
    rows.length < matches.length
      ? `${rows.length} outlet listings shown of ${matches.length}`
      : `${matches.length} outlet listings`;
  const unpricedNote = hasBudget && unpriced > 0 ? ` (${unpriced} excluded: no price)` : "";
  process.stderr.write(`# ${countNote}${matchNote}${totalNote}${unpricedNote}\n`);

  writeOutput(rows, opts);
}

export async function getOutlet(id: string, opts: OutputOpts): Promise<void> {
  const res = await client().request<unknown>(`/outlets/${id}`);
  writeObject(res, opts);
}

export async function outletProducts(id: string, opts: OutputOpts): Promise<void> {
  const res = await client().request<unknown>(`/outlets/${id}/products`);
  writeOutput(unwrapList(res, ["products"]), opts);
}

export async function countries(opts: OutputOpts): Promise<void> {
  const res = await client().request<unknown>("/outlets/locations/countries");
  writeOutput(unwrapList(res, ["countries"]), opts);
}

export async function states(country: string | undefined, opts: OutputOpts): Promise<void> {
  const res = await client().request<unknown>("/outlets/locations/states", {
    query: { country },
  });
  writeOutput(unwrapList(res, ["states"]), opts);
}

export async function cities(
  country: string | undefined,
  state: string | undefined,
  opts: OutputOpts,
): Promise<void> {
  const res = await client().request<unknown>("/outlets/locations/cities", {
    query: { country, state },
  });
  writeOutput(unwrapList(res, ["cities"]), opts);
}

export async function tags(opts: OutputOpts): Promise<void> {
  const res = await client().request<unknown>("/tags");
  writeOutput(unwrapList(res, ["tags"]), opts);
}

export async function disclaimers(opts: OutputOpts): Promise<void> {
  const res = await client().request<unknown>("/outlet-disclaimers");
  writeObject(res, opts);
}
