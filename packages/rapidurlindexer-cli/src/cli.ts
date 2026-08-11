import { Command } from "commander";
import {
  RapidUrlIndexerApiError,
  RapidUrlIndexerClient,
  type CreateProjectInput,
} from "./client.ts";
import { mergeUrls, readUrlsFile } from "./urls.ts";

interface GlobalOptions {
  apiKey?: string;
  baseUrl?: string;
  pretty?: boolean;
}

export function buildProgram(): Command {
  const program = new Command()
    .name("rapidurlindexer")
    .description("Rapid URL Indexer CLI: submit URL projects and inspect their long-running status.")
    .version("0.1.0")
    .option("--api-key <key>", "API key (or RAPIDURLINDEXER_API_KEY)")
    .option("--base-url <url>", "API base URL (or RAPIDURLINDEXER_API_BASE_URL)")
    .option("--pretty", "Pretty-print JSON output")
    .addHelpText(
      "after",
      `
Environment:
  RAPIDURLINDEXER_API_KEY       API key from the My Projects dashboard
  RAPIDURLINDEXER_API_BASE_URL  override the production API base URL

Notes:
  Project creation spends credits and is never automatically retried.
  Reports normally return HTTP 425 until 96 hours after project creation.

Examples:
  rapidurlindexer credits balance
  rapidurlindexer projects list
  rapidurlindexer projects create --name release-2026-07-14 --urls-file urls.txt
  rapidurlindexer projects get 123
  rapidurlindexer projects report 123
  rapidurlindexer projects report 123 --format csv`,
    );

  const globalOptions = (): GlobalOptions => program.opts<GlobalOptions>();

  const client = (): RapidUrlIndexerClient => {
    const options = globalOptions();
    const apiKey = options.apiKey
      ?? process.env.RAPIDURLINDEXER_API_KEY
      ?? process.env.RAPID_URL_INDEXER_API_KEY;
    if (!apiKey) {
      throw new Error("Missing API key. Set RAPIDURLINDEXER_API_KEY or pass --api-key.");
    }
    const baseUrl = options.baseUrl ?? process.env.RAPIDURLINDEXER_API_BASE_URL;
    return new RapidUrlIndexerClient({ apiKey, ...(baseUrl ? { baseUrl } : {}) });
  };

  const json = (value: unknown): void => {
    process.stdout.write(JSON.stringify(value, null, globalOptions().pretty ? 2 : undefined) + "\n");
  };

  const run = <T extends unknown[]>(action: (...args: T) => Promise<void>) =>
    async (...args: T): Promise<void> => {
      try {
        await action(...args);
      } catch (error) {
        fail(error);
      }
    };

  const credits = program.command("credits").description("Inspect account credits");
  credits
    .command("balance")
    .description("Get the current credit balance")
    .action(run(async () => json(await client().getCreditBalance())));

  const projects = program.command("projects").description("Create and inspect indexing projects");

  projects
    .command("list")
    .description("List projects, newest first")
    .action(run(async () => json(await client().listProjects())));

  projects
    .command("get <project-id>")
    .description("Get project status and indexing progress")
    .action(run(async (projectId: string) => json(await client().getProject(parseProjectId(projectId)))));

  projects
    .command("create")
    .description("Create an indexing project (spends credits; this command is not retried)")
    .requiredOption("--name <name>", "Project name (1-255 characters)")
    .option("--url <url>", "URL to submit; repeat for multiple URLs", collect, [])
    .option("--urls-file <path>", "Newline-delimited URL file (blank/comment lines ignored)")
    .option("--notify", "Email on project status changes", false)
    .option("--apex", "Enable Apex Mode (costs 3 credits per URL)", false)
    .action(
      run(async (options: {
        name: string;
        url: string[];
        urlsFile?: string;
        notify: boolean;
        apex: boolean;
      }) => {
        const fromFile = options.urlsFile ? await readUrlsFile(options.urlsFile) : [];
        const urls = mergeUrls(options.url, fromFile);
        const input: CreateProjectInput = {
          project_name: options.name,
          urls,
          notify_on_status_change: options.notify,
          apex_mode_enabled: options.apex,
        };
        const response = await client().createProject(input);
        json({
          ...response,
          submitted_urls: response.submitted_urls ?? response.total_urls ?? urls.length,
        });
      }),
    );

  projects
    .command("report <project-id>")
    .description("Get per-URL results (normally available 96 hours after creation)")
    .option("--format <format>", "Output format: json | csv", "json")
    .action(
      run(async (projectId: string, options: { format: string }) => {
        const id = parseProjectId(projectId);
        if (options.format === "json") {
          json(await client().getProjectReport(id, "json"));
          return;
        }
        if (options.format === "csv") {
          process.stdout.write(await client().getProjectReport(id, "csv"));
          return;
        }
        throw new Error(`Unknown report format: ${options.format}. Use json or csv.`);
      }),
    );

  return program;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseProjectId(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error("project id must be a positive integer");
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("project id must be a positive integer");
  return id;
}

function fail(error: unknown): never {
  if (error instanceof RapidUrlIndexerApiError) {
    process.stderr.write(
      JSON.stringify({
        error: error.message,
        status: error.status,
        kind: error.kind,
        ...(error.hint ? { hint: error.hint } : {}),
        ...(error.retryAfterSeconds !== undefined
          ? { retry_after_seconds: error.retryAfterSeconds }
          : {}),
      }) + "\n",
    );
  } else {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(JSON.stringify({ error: message }) + "\n");
  }
  process.exit(1);
}
