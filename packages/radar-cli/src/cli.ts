import { Command } from "commander";
import * as auth from "./auth.ts";
import * as analytics from "./commands/analytics.ts";
import * as jobs from "./commands/jobs.ts";
import * as models from "./commands/models.ts";

/**
 * Build the Radar Commander program. Pure function — no side effects, safe
 * to call from in-process wrappers (`@mirage-cli/radar`) or the CLI entry
 * point below.
 */
export function buildProgram(): Command {
  const program = new Command();
  program
    .name("radar")
    .description("ViewEngine Radar CLI — batch AI visibility jobs")
    .version("0.1.0");

  program
    .command("login")
    .description("Login via Clerk OAuth (browser) or --api-key for headless/CI")
    .option("--api-key <key>", "Clerk API key (skips the OAuth browser flow)")
    .option("--base-url <url>", "Override API base URL")
    .action(async (opts: { apiKey?: string; baseUrl?: string }) => {
      if (opts.apiKey) {
        await auth.loginWithApiKey(opts.apiKey, opts.baseUrl);
      } else {
        await auth.loginWithOAuth(opts.baseUrl);
      }
    });

  program
    .command("whoami")
    .description("Show current session")
    .action(async () => {
      await auth.whoami();
    });

  program
    .command("logout")
    .description("Clear saved session")
    .action(() => {
      auth.logout();
    });

  const jobsCmd = program.command("jobs").description("Manage batch jobs");

  jobsCmd
    .command("list")
    .description("List your batch jobs")
    .option("-f, --format <fmt>", "Output format: ascii|json|csv|markdown", "ascii")
    .option("-o, --output <file>", "Write output to file")
    .action(async (opts: { format?: string; output?: string }) => jobs.listJobs(opts));

  jobsCmd
    .command("get <id>")
    .description("Get job details (includes queue_position for pending jobs)")
    .option("-f, --format <fmt>", "Output format", "ascii")
    .option("-o, --output <file>", "Write output to file")
    .action(async (id: string, opts: { format?: string; output?: string }) =>
      jobs.getJob(id, opts),
    );

  jobsCmd
    .command("cancel <id>")
    .description("Cancel a pending/processing job, or delete a finished one")
    .action(async (id: string) => jobs.cancelJob(id));

  jobsCmd
    .command("cancel-bulk <ids>")
    .description("Cancel multiple jobs (comma-separated IDs)")
    .action(async (ids: string) => {
      const list = ids
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      await jobs.cancelBulk(list);
    });

  jobsCmd
    .command("retry <id>")
    .description("Retry a failed/cancelled job")
    .option("--failed-only", "Only retry failed row+model combinations")
    .action(async (id: string, opts: { failedOnly?: boolean }) =>
      jobs.retryJob(id, { failedOnly: opts.failedOnly }),
    );

  jobsCmd
    .command("create")
    .description("Create a new batch job from a CSV file")
    .requiredOption("--file <path>", "CSV file path")
    .requiredOption("--name <name>", "Job name")
    .requiredOption("--prompt-column <col>", "CSV column containing prompts")
    .requiredOption(
      "--models <list>",
      "Comma-separated model kinds (chatgpt_api,perplexity,gemini,ai_mode,ai_overview,chatgpt_public,gemini_public)",
    )
    .option(
      "--concurrency <n>",
      "Parallel processing limit",
      (v: string) => Number.parseInt(v, 10),
      5,
    )
    .option("--notify", "Email me on completion (uses your verified Clerk email)")
    .option(
      "--location-code <n>",
      "Location code for geo-targeted models (e.g. 2840 = US, 2826 = UK)",
      (v: string) => Number.parseInt(v, 10),
    )
    .option("--no-append-location", "Don't append location to prompt (Gemini/ChatGPT Web)")
    .action(async (opts: jobs.CreateJobOpts) => jobs.createJob(opts));

  jobsCmd
    .command("download <id>")
    .description("Download job results CSV")
    .option("-o, --output <file>", "Output path")
    .option("--partial", "Download partial results while job is still running")
    .action(async (id: string, opts: { output?: string; partial?: boolean }) =>
      jobs.downloadResults(id, opts.output, opts.partial),
    );

  jobsCmd
    .command("errors <id>")
    .description("Show job errors")
    .option("-f, --format <fmt>", "Output format", "ascii")
    .option("-o, --output <file>", "Write output to file")
    .action(async (id: string, opts: { format?: string; output?: string }) =>
      jobs.getErrors(id, opts),
    );

  jobsCmd
    .command("preview")
    .description("Preview a CSV before creating a job")
    .requiredOption("--file <path>", "CSV file path")
    .option("-f, --format <fmt>", "Output format", "ascii")
    .action(async (opts: { file: string; format?: string; output?: string }) =>
      jobs.previewCsv(opts.file, opts),
    );

  program
    .command("models")
    .description("List available AI models")
    .option("-f, --format <fmt>", "Output format", "ascii")
    .option("-o, --output <file>", "Write output to file")
    .action(async (opts: { format?: string; output?: string }) => models.listModels(opts));

  const analyticsCmd = program.command("analytics").description("Usage analytics");

  analyticsCmd
    .command("summary")
    .description("Usage summary: jobs, rows, model usage")
    .option("-f, --format <fmt>", "Output format", "ascii")
    .option("-o, --output <file>", "Write output to file")
    .action(async (opts: { format?: string; output?: string }) =>
      analytics.analyticsSummary(opts),
    );

  analyticsCmd
    .command("activity")
    .description("Recent job activity")
    .option("-f, --format <fmt>", "Output format", "ascii")
    .option("-o, --output <file>", "Write output to file")
    .action(async (opts: { format?: string; output?: string }) =>
      analytics.analyticsActivity(opts),
    );

  analyticsCmd
    .command("export")
    .description("Export analytics jobs as CSV")
    .option("--period <p>", "Period (7d|30d|90d)", "7d")
    .option("-o, --output <file>", "Output path")
    .action(async (opts: { period: string; output?: string }) =>
      analytics.analyticsExport(opts.period, opts.output),
    );

  return program;
}
