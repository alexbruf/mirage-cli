import { readFileSync } from "node:fs";
import { ApiClient } from "../client.ts";
import { requireSession } from "../config.ts";
import { type OutputOpts, unwrapList, writeObject, writeOutput } from "../output.ts";

function client(): ApiClient {
  return new ApiClient(requireSession());
}

export async function listProfiles(teamId: string, opts: OutputOpts): Promise<void> {
  const res = await client().request<unknown>(`/teams/${teamId}/profiles`);
  writeOutput(unwrapList(res, ["profiles"]), opts);
}

export async function createProfile(body: unknown, opts: OutputOpts): Promise<void> {
  const res = await client().json("POST", "/profiles", body);
  writeObject(res, opts);
}

export async function createProfileFromFile(file: string, opts: OutputOpts): Promise<void> {
  const body = JSON.parse(readFileSync(file, "utf8")) as unknown;
  return createProfile(body, opts);
}

export async function updateProfile(
  id: string,
  body: unknown,
  opts: OutputOpts,
): Promise<void> {
  const res = await client().json("PATCH", `/profiles/${id}`, body);
  writeObject(res, opts);
}

export async function profileOrders(id: string, opts: OutputOpts): Promise<void> {
  const res = await client().request<unknown>(`/profiles/${id}/orders`);
  writeOutput(unwrapList(res, ["orders"]), opts);
}

export async function profileOrderItems(id: string, opts: OutputOpts): Promise<void> {
  const res = await client().request<unknown>(`/profiles/${id}/order-items`);
  writeOutput(unwrapList(res, ["order_items"]), opts);
}

export async function profileCampaigns(id: string, opts: OutputOpts): Promise<void> {
  const res = await client().request<unknown>(`/profiles/${id}/campaigns`);
  writeOutput(unwrapList(res, ["campaigns"]), opts);
}
