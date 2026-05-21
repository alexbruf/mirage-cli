import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { ApiClient } from "../client.ts";
import { requireSession } from "../config.ts";
import { type OutputOpts, writeObject, writeOutput } from "../output.ts";

export interface Job {
  id: string;
  name: string;
  status: string;
  total_rows: number;
  completed_rows: number;
  failed_rows: number;
  models: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  queue_position?: number | null;
}

function client(): ApiClient {
  return new ApiClient(requireSession());
}

export async function listJobs(opts: OutputOpts): Promise<void> {
  const res = await client().request<{ jobs: Job[] }>("/jobs");
  const rows = res.jobs.map((j) => ({
    id: j.id,
    name: j.name,
    status: j.status,
    progress: `${j.completed_rows}/${j.total_rows}`,
    failed: j.failed_rows,
    models: j.models,
    created: j.created_at,
  }));
  writeOutput(rows, opts);
}

export async function getJob(id: string, opts: OutputOpts): Promise<void> {
  const job = await client().request<Job>(`/jobs/${id}`);
  writeObject(job, opts);
}

export async function cancelJob(id: string): Promise<void> {
  const res = await client().request<{ success: boolean; action: string }>(`/jobs/${id}`, {
    method: "DELETE",
  });
  console.log(`${res.action}: ${id}`);
}

export async function cancelBulk(ids: string[]): Promise<void> {
  const res = await client().request<{ cancelled: string[]; failed: string[] }>("/jobs/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobIds: ids }),
  });
  const cancelled = res.cancelled?.length ?? 0;
  const failed = res.failed?.length ?? 0;
  console.log(`Cancelled: ${cancelled}, Failed: ${failed}`);
}

export async function retryJob(id: string, opts: { failedOnly?: boolean }): Promise<void> {
  const res = await client().request<{ success: boolean; retryCount: number }>(
    `/jobs/${id}/retry`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retryFailedOnly: opts.failedOnly ?? false }),
    },
  );
  console.log(`Retried ${id} (attempt ${res.retryCount})`);
}

export interface CreateJobOpts {
  file: string;
  name: string;
  promptColumn: string;
  models: string;
  concurrency?: number;
  notify?: boolean;
  locationCode?: number;
  appendLocation?: boolean;
}

export async function createJob(opts: CreateJobOpts): Promise<void> {
  const buf = readFileSync(opts.file);
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "text/csv" }), basename(opts.file));
  form.append("name", opts.name);
  form.append("prompt_column", opts.promptColumn);
  form.append("models", opts.models);
  form.append("concurrency", String(opts.concurrency ?? 5));
  form.append("notify", opts.notify ? "true" : "false");
  if (opts.locationCode !== undefined) form.append("location_code", String(opts.locationCode));
  if (opts.appendLocation === false) form.append("append_location", "false");

  const res = await client().request<{
    id: string;
    name: string;
    status: string;
    total_rows: number;
    creditsUsed: number;
  }>("/jobs", {
    method: "POST",
    body: form as unknown as BodyInit,
  });
  console.log(`Created job ${res.id}`);
  console.log(`  Name: ${res.name}`);
  console.log(`  Rows: ${res.total_rows}`);
  console.log(`  Credits used: ${res.creditsUsed}`);
}

export async function downloadResults(id: string, output?: string, partial = false): Promise<void> {
  const path = partial ? `/jobs/${id}/download-partial` : `/jobs/${id}/download`;
  const res = await client().requestRaw(path);
  const text = await res.text();
  const outPath = output ?? `${id}-results.csv`;
  writeFileSync(outPath, text);
  console.log(`Downloaded to ${outPath}`);
}

export async function getErrors(id: string, opts: OutputOpts): Promise<void> {
  const res = await client().request<{ errors: unknown[] }>(`/jobs/${id}/errors`);
  writeOutput(res.errors, opts);
}

export async function previewCsv(file: string, opts: OutputOpts): Promise<void> {
  const buf = readFileSync(file);
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "text/csv" }), basename(file));
  const res = await client().request<{
    headers: string[];
    preview: Record<string, unknown>[];
    rowCount: number;
  }>("/jobs/preview", {
    method: "POST",
    body: form as unknown as BodyInit,
  });
  console.log(`Headers: ${res.headers.join(", ")}`);
  console.log(`Preview (${res.preview.length} rows):`);
  writeOutput(res.preview, opts);
}
