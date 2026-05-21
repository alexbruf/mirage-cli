import { writeFileSync } from "node:fs";
import { ApiClient } from "../client.ts";
import { requireSession } from "../config.ts";
import { type OutputOpts, writeObject, writeOutput } from "../output.ts";

function client(): ApiClient {
  return new ApiClient(requireSession());
}

export async function analyticsSummary(opts: OutputOpts): Promise<void> {
  const res = await client().request<unknown>("/analytics");
  writeObject(res, opts);
}

export async function analyticsActivity(opts: OutputOpts): Promise<void> {
  const res = await client().request<{ activity: unknown[] }>("/analytics/activity");
  writeOutput(res.activity, opts);
}

export async function analyticsExport(period: string, output?: string): Promise<void> {
  const raw = await client().requestRaw("/analytics/export", { query: { period } });
  const text = await raw.text();
  const outPath = output ?? `analytics-${period}.csv`;
  writeFileSync(outPath, text);
  console.log(`Wrote ${outPath}`);
}
