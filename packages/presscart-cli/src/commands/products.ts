import { ApiClient } from "../client.ts";
import { requireSession } from "../config.ts";
import {
  type OutputOpts,
  type PriceFilterOpts,
  writeList,
  writeObject,
} from "../output.ts";

function client(): ApiClient {
  return new ApiClient(requireSession());
}

export async function getProduct(id: string, opts: OutputOpts): Promise<void> {
  const res = await client().request<unknown>(`/products/${id}`);
  writeObject(res, opts);
}

export interface ListingsOpts extends OutputOpts, PriceFilterOpts {
  limit?: number;
  page?: number;
  channel?: string;
  outlet?: string;
}

export async function listings(opts: ListingsOpts): Promise<void> {
  const res = await client().request<unknown>("/products/listings", {
    query: {
      limit: opts.limit,
      page: opts.page,
      channel: opts.channel,
      outlet: opts.outlet,
    },
  });
  // No server-side price filter; --min/max-price applied client-side (whole USD).
  writeList(res, ["listings"], opts);
}

export async function categories(opts: OutputOpts): Promise<void> {
  const res = await client().request<unknown>("/products/categories");
  writeObject(res, opts);
}
