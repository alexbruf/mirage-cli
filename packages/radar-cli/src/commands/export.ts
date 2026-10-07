/**
 * `radar export-results` — full-history NDJSON streamed from
 * /api/v1/export-full (the dashboard's own export router, remounted).
 *
 * Ported from the prod `ve-radar` CLI (prod-ai-visibility-tool
 * `cli/commands/export.ts`) — keep the two in lockstep; only the client call
 * differs (requestRaw + `/v1/...`).
 */
import type { Command } from "commander";
import type { ApiClient } from "../client.ts";

type GetClient = () => Promise<ApiClient>;

export interface ExportResultsOpts {
  project: string;
  since?: string;
  until?: string;
  fields?: string;
  /** Commander sets this to false for `--no-text`. */
  text?: boolean;
  output?: string;
}

/** CLI flags → /export-full query params (undefined values are dropped). */
export function exportFullParams(opts: ExportResultsOpts): Record<string, string | undefined> {
  return {
    projectId: opts.project,
    since: opts.since,
    until: opts.until,
    fields: opts.fields,
    text: opts.text === false ? "0" : undefined,
  };
}

export function registerExportCommands(program: Command, getClient: GetClient): void {
  program
    .command("export-results")
    .description("Full-history NDJSON export, streamed server-side (no client paging)")
    .requiredOption("--project <id>", "Project id")
    .option(
      "--since <date>",
      "Only rows created STRICTLY AFTER this ISO timestamp (the server's resume-cursor semantics: pass the last createdAt you already have)",
    )
    .option(
      "--until <date>",
      "Only rows created up to this point: YYYY-MM-DD means through the end of that day (UTC); an ISO timestamp is inclusive",
    )
    .option(
      "--fields <list>",
      "Comma list of row fields: queryId,queryText,category,provider,runNumber,createdAt,isError,responseText,citations,brands (default all)",
    )
    .option(
      "--no-text",
      "Leave out responseText (the bulk of every row; also skips server R2 reads)",
    )
    .option("-o, --output <file>", "Write to file instead of stdout")
    .action(async (opts: ExportResultsOpts) => {
      const client = await getClient();
      const res = await client.requestRaw("/v1/export-full", { query: exportFullParams(opts) });
      if (!res.body) throw new Error("Empty response body");
      if (opts.output) {
        const { createWriteStream } = await import("node:fs");
        const { Writable } = await import("node:stream");
        await res.body.pipeTo(Writable.toWeb(createWriteStream(opts.output)) as WritableStream);
        console.error(`Wrote ${opts.output}`);
      } else {
        await res.body.pipeTo(stdoutStream());
      }
    });
}

/** stdout as a WritableStream (kept tiny; Bun/Node both support this). */
function stdoutStream(): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      process.stdout.write(chunk);
    },
  });
}
