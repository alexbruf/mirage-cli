import { get, type DfsResponse } from "../lib/client.ts";

export async function listLocations(api = "serp/google"): Promise<DfsResponse> {
  return get(`${api}/locations`);
}

export async function listLanguages(api = "serp/google"): Promise<DfsResponse> {
  return get(`${api}/languages`);
}

export async function userData(): Promise<DfsResponse> {
  return get("/v3/appendix/user_data");
}
