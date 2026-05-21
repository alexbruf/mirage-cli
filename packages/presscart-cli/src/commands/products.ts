import { ApiClient } from "../client.ts";
import { requireSession } from "../config.ts";
import { type OutputOpts, unwrapList, writeObject, writeOutput } from "../output.ts";

function client(): ApiClient {
  return new ApiClient(requireSession());
}

export async function getProduct(id: string, opts: OutputOpts): Promise<void> {
  const res = await client().request<unknown>(`/products/${id}`);
  writeObject(res, opts);
}

export interface ListingsOpts extends OutputOpts {
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
  writeOutput(unwrapList(res, ["listings"]), opts);
}

export async function categories(opts: OutputOpts): Promise<void> {
  const res = await client().request<unknown>("/products/categories");
  writeObject(res, opts);
}
