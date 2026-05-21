import { readFileSync } from "node:fs";
import { ApiClient } from "../client.ts";
import { requireSession } from "../config.ts";
import { type OutputOpts, unwrapList, writeObject, writeOutput } from "../output.ts";

function client(): ApiClient {
  return new ApiClient(requireSession());
}

export async function listOrders(opts: OutputOpts): Promise<void> {
  const res = await client().request<unknown>("/orders");
  writeOutput(unwrapList(res, ["orders"]), opts);
}

export async function getOrder(id: string, opts: OutputOpts): Promise<void> {
  const res = await client().request<unknown>(`/orders/${id}`);
  writeObject(res, opts);
}

export async function listOrderItems(opts: OutputOpts): Promise<void> {
  const res = await client().request<unknown>("/order-items");
  writeOutput(unwrapList(res, ["order_items"]), opts);
}

export interface CheckoutLineItem {
  product_id: string;
  quantity: number;
  is_add_on?: boolean;
  linked_order_line_item_id?: string;
}

export interface CheckoutBody {
  profile_id: string;
  line_items: CheckoutLineItem[];
  discount?: string | number;
}

export async function checkout(body: CheckoutBody, opts: OutputOpts): Promise<void> {
  const res = await client().json("POST", "/orders/checkout", body);
  writeObject(res, opts);
}

export async function checkoutFromFile(file: string, opts: OutputOpts): Promise<void> {
  const body = JSON.parse(readFileSync(file, "utf8")) as CheckoutBody;
  return checkout(body, opts);
}
