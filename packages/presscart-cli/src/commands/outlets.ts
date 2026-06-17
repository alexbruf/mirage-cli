import { ApiClient } from "../client.ts";
import { requireSession } from "../config.ts";
import { type OutputOpts, unwrapList, writeObject, writeOutput } from "../output.ts";

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

/**
 * Outlet listing price in whole USD. Presscart lists carry the placement price
 * in `unit_amount` as whole dollars (BLU-641); we fall back to a few common
 * field names. Returns undefined when no numeric price is present.
 */
export function outletPriceUsd(rec: Record<string, unknown>): number | undefined {
  for (const k of ["unit_amount", "price", "amount", "cost", "unit_price"]) {
    const v = rec[k];
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
    if (Number.isFinite(n)) return n;
  }
  return undefined;
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

export async function listOutlets(opts: ListOutletsOpts): Promise<void> {
  const api = client();
  const baseQuery = {
    limit: opts.limit,
    search: opts.search,
    country: opts.country,
    state: opts.state,
    city: opts.city,
    tag: opts.tag,
  };

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

  let records = await fetchPage(opts.page ?? 1);
  if (opts.all) {
    for (let p = 2; p <= totalPages && p <= PAGE_CAP; p++) {
      records = records.concat(await fetchPage(p));
    }
    if (totalPages > PAGE_CAP) {
      process.stderr.write(`# warning: stopped at ${PAGE_CAP} pages (total_pages=${totalPages})\n`);
    }
  }

  // $ formatting: add a human price column from the detected price field.
  const formatted = records.map((r) => {
    const usd = outletPriceUsd(r);
    return usd === undefined ? r : { ...r, price_usd: `$${usd.toLocaleString("en-US")}` };
  });

  // Budget filter. Rows with no detectable price are excluded from a budget
  // query (can't prove they fit) and that exclusion is reported.
  const hasBudget = opts.minPrice !== undefined || opts.maxPrice !== undefined;
  let unpriced = 0;
  const rows = !hasBudget
    ? formatted
    : formatted.filter((r) => {
        const usd = outletPriceUsd(r);
        if (usd === undefined) {
          unpriced++;
          return false;
        }
        if (opts.minPrice !== undefined && usd < opts.minPrice) return false;
        if (opts.maxPrice !== undefined && usd > opts.maxPrice) return false;
        return true;
      });

  // Total-count summary to stderr so stdout stays clean for json/csv piping.
  const totalNote = totalRecords !== undefined ? ` of ${totalRecords} total` : "";
  const budgetNote = hasBudget ? ` matching ${budgetLabel(opts.minPrice, opts.maxPrice)}` : "";
  const unpricedNote = hasBudget && unpriced > 0 ? ` (${unpriced} excluded: no price)` : "";
  process.stderr.write(`# ${rows.length} outlet listings${budgetNote}${totalNote}${unpricedNote}\n`);

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
