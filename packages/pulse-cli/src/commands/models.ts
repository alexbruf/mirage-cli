import { ApiClient } from "../client.ts";
import { requireSession } from "../config.ts";
import { type OutputOpts, writeOutput } from "../output.ts";

export async function listModels(opts: OutputOpts): Promise<void> {
  const client = new ApiClient(requireSession());
  const res = await client.request<{ models: unknown[] }>("/models");
  writeOutput(res.models, opts);
}
