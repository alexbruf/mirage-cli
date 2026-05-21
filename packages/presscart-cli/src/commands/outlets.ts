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
}

export async function listOutlets(opts: ListOutletsOpts): Promise<void> {
  const res = await client().request<unknown>("/outlets", {
    query: {
      limit: opts.limit,
      page: opts.page,
      search: opts.search,
      country: opts.country,
      state: opts.state,
      city: opts.city,
      tag: opts.tag,
    },
  });
  writeOutput(unwrapList(res, ["outlets"]), opts);
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
