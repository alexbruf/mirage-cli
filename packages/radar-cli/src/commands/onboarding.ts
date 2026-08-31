import { type Command, InvalidArgumentError } from "commander";
import { type ApiClient, DEFAULT_SSE_TIMEOUT_MS } from "../client.ts";

type GetClient = () => Promise<ApiClient>;

interface MirageFileIoBridge {
  canHandle?(path: unknown): boolean;
  readFileSync?(path: unknown, options?: unknown): string | Uint8Array | null;
}

export const ONBOARDING_SECTIONS = [
  "business",
  "personas",
  "competitors",
  "funnelMix",
  "location",
  "domain",
] as const;

export type OnboardingSection = (typeof ONBOARDING_SECTIONS)[number];

interface SseCommandOptions {
  timeout: number;
  verbose?: boolean;
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function fileIoBridge(): MirageFileIoBridge | undefined {
  return (
    globalThis as typeof globalThis & { __MIRAGE_CLI_FILE_IO__?: MirageFileIoBridge }
  ).__MIRAGE_CLI_FILE_IO__;
}

/**
 * Read through Mirage's VFS bridge when present, then fall back to local
 * node:fs. The fallback is dynamically imported so mounted workerd calls for
 * /sessions and /data never need a Node filesystem implementation.
 */
async function readJsonFile(path: string): Promise<string> {
  const bridge = fileIoBridge();
  if (bridge?.canHandle?.(path)) {
    const value = bridge.readFileSync?.(path, "utf8");
    if (typeof value === "string") return value;
    if (value instanceof Uint8Array) return new TextDecoder().decode(value);
    throw new Error(`Mirage VFS JSON file not found: ${path}`);
  }

  const { readFileSync } = await import("node:fs");
  return readFileSync(path, "utf8");
}

export async function parseJsonOption<T = unknown>(
  value: string,
  optionName: string,
): Promise<T> {
  let source = value;
  let filePath: string | undefined;

  if (value.startsWith("@")) {
    filePath = value.slice(1);
    if (!filePath) throw new InvalidArgumentError(`${optionName} requires a path after @`);
    try {
      source = await readJsonFile(filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new InvalidArgumentError(
        `Could not read JSON for ${optionName} from ${filePath}: ${message}`,
      );
    }
  }

  try {
    return JSON.parse(source) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const sourceName = filePath ? ` from ${filePath}` : "";
    throw new InvalidArgumentError(`Invalid JSON for ${optionName}${sourceName}: ${message}`);
  }
}

export function parseOnboardingSection(value: string): OnboardingSection {
  if ((ONBOARDING_SECTIONS as readonly string[]).includes(value)) {
    return value as OnboardingSection;
  }
  throw new InvalidArgumentError(
    `Invalid --section value "${value}". Expected one of: ${ONBOARDING_SECTIONS.join(", ")}`,
  );
}

function parseTimeout(value: string): number {
  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new InvalidArgumentError("--timeout must be a positive integer in milliseconds");
  }
  return timeout;
}

async function runSse<T>(
  client: ApiClient,
  path: string,
  body: unknown,
  opts: SseCommandOptions,
): Promise<T> {
  const statusMessages: string[] = [];
  try {
    return await client.postSse<T>(path, body, {
      timeoutMs: opts.timeout,
      statusMessages,
    });
  } finally {
    if (opts.verbose) {
      for (const message of statusMessages) process.stderr.write(`${message}\n`);
    }
  }
}

function addSseOptions(command: Command): Command {
  return command
    .option(
      "--timeout <ms>",
      "Abort if the SSE operation exceeds this many milliseconds",
      parseTimeout,
      DEFAULT_SSE_TIMEOUT_MS,
    )
    .option("--verbose", "Print buffered status messages to stderr after the stream finishes");
}

export function registerOnboardingCommands(program: Command, getClient: GetClient): void {
  const onboarding = program.command("onboarding").description("Create and onboard projects");

  onboarding
    .command("create <domain>")
    .description("Create or reuse an incomplete project for a domain")
    .action(async (domain: string) => {
      printJson(await (await getClient()).post("/onboarding/new", { action: "create", domain }));
    });

  onboarding
    .command("status <projectId>")
    .description("Get a project's onboarding status and profile")
    .action(async (projectId: string) => {
      printJson(
        await (await getClient()).request(`/onboarding/${encodeURIComponent(projectId)}`),
      );
    });

  addSseOptions(
    onboarding
      .command("analyze <projectId>")
      .description("Analyze a domain and return the completed profile")
      .requiredOption("--domain <domain>", "Domain to analyze"),
  ).action(async (projectId: string, opts: SseCommandOptions & { domain: string }) => {
    const result = await runSse(
      await getClient(),
      `/onboarding/${encodeURIComponent(projectId)}`,
      { action: "analyze", domain: opts.domain },
      opts,
    );
    printJson(result);
  });

  onboarding
    .command("save <projectId>")
    .description("Save one onboarding profile section")
    .requiredOption(
      "--section <section>",
      `Section: ${ONBOARDING_SECTIONS.join("|")}`,
      parseOnboardingSection,
    )
    .requiredOption("--data <json|@file>", "Section data as inline JSON or @file")
    .action(async (projectId: string, opts: { section: OnboardingSection; data: string }) => {
      const data = await parseJsonOption(opts.data, "--data");
      printJson(
        await (await getClient()).post(`/onboarding/${encodeURIComponent(projectId)}`, {
          action: "save",
          section: opts.section,
          data,
        }),
      );
    });

  addSseOptions(
    onboarding
      .command("generate-queries <projectId>")
      .description("Generate onboarding queries from a completed profile")
      .requiredOption("--profile <json|@file>", "Profile as inline JSON or @file")
      .option("--funnel-mix <json|@file>", "Optional funnel mix as inline JSON or @file"),
  ).action(
    async (
      projectId: string,
      opts: SseCommandOptions & { profile: string; funnelMix?: string },
    ) => {
      const body: Record<string, unknown> = {
        action: "generate-queries",
        profile: await parseJsonOption(opts.profile, "--profile"),
      };
      if (opts.funnelMix !== undefined) {
        body.funnelMix = await parseJsonOption(opts.funnelMix, "--funnel-mix");
      }
      const result = await runSse(
        await getClient(),
        `/onboarding/${encodeURIComponent(projectId)}`,
        body,
        opts,
      );
      printJson(result);
    },
  );

  onboarding
    .command("complete <projectId>")
    .description("Complete onboarding with the approved queries")
    .requiredOption("--queries <json|@file>", "Query array as inline JSON or @file")
    .action(async (projectId: string, opts: { queries: string }) => {
      const queries = await parseJsonOption(opts.queries, "--queries");
      printJson(
        await (await getClient()).post(`/onboarding/${encodeURIComponent(projectId)}`, {
          action: "complete",
          queries,
        }),
      );
    });
}
