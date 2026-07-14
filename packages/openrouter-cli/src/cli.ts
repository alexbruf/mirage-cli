import { Command } from "commander";
import { ApiError, type ChatRequest, type ChatResponse, OpenRouterClient, type Query } from "./client.ts";
import { resolveConfig } from "./config.ts";
import { parseFormat, renderList, renderObject, type Format } from "./output.ts";

const VERSION = "0.1.0";

interface GlobalOptions {
  apiKey?: string;
  baseUrl?: string;
  httpReferer?: string;
  appTitle?: string;
  appCategories?: string;
  format?: string;
}

interface ChatOptions {
  model?: string;
  prompt?: string;
  system?: string;
  request?: string;
  maxCompletionTokens?: string;
  temperature?: string;
  provider: string[];
  requireParameters?: boolean;
  zdr?: boolean;
  sessionId?: string;
  user?: string;
  stream?: boolean;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("openrouter")
    .description(
      "OpenRouter CLI for model discovery, quota inspection, generation metadata, and chat completions.",
    )
    .version(VERSION)
    .option("--api-key <key>", "API key (or OPENROUTER_API_KEY)")
    .option("--base-url <url>", "API base URL (or OPENROUTER_API_BASE_URL)")
    .option("--http-referer <url>", "Optional HTTP-Referer app attribution header")
    .option("--app-title <name>", "Optional X-OpenRouter-Title app attribution header")
    .option("--app-categories <list>", "Optional X-OpenRouter-Categories header")
    .option("-f, --format <fmt>", "Output: json | jsonl | table | csv | text", "json");

  const globals = (): GlobalOptions => program.opts<GlobalOptions>();
  const format = (): Format => parseFormat(globals().format);
  const client = (): OpenRouterClient => {
    const cfg = resolveConfig(globals());
    return new OpenRouterClient(cfg);
  };

  const models = program.command("models").description("Discover OpenRouter models and endpoints");
  models
    .command("list")
    .description("List models, optionally filtered and server-sorted")
    .option("-q, --query <text>", "Free-text model name or slug search")
    .option("--supports <list>", "Required supported parameters, comma-separated")
    .option("--input-modality <list>", "Input modalities, comma-separated")
    .option("--output-modality <list>", "Output modalities, comma-separated")
    .option("--sort <order>", "Server sort, such as pricing-low-to-high or context-high-to-low")
    .option("--context <tokens>", "Minimum context length")
    .option("--min-price <amount>", "Minimum prompt price in dollars per million tokens")
    .option("--max-price <amount>", "Maximum prompt price in dollars per million tokens")
    .option("--author <list>", "Model author slugs, comma-separated")
    .option("--provider <list>", "Hosting providers, comma-separated")
    .option("--arch <name>", "Architecture or model family")
    .option("--zdr", "Only zero-data-retention models")
    .option("--region <region>", "Data region, currently eu")
    .option("--eligible", "Use the API-key-filtered /models/user catalog")
    .action(async (opts: Record<string, string | boolean | undefined>) => {
      const query: Query = {
        q: stringOpt(opts.query),
        supported_parameters: stringOpt(opts.supports),
        input_modalities: stringOpt(opts.inputModality),
        output_modalities: stringOpt(opts.outputModality),
        sort: stringOpt(opts.sort),
        context: numberOpt(opts.context),
        min_price: numberOpt(opts.minPrice),
        max_price: numberOpt(opts.maxPrice),
        model_authors: stringOpt(opts.author),
        providers: stringOpt(opts.provider),
        arch: stringOpt(opts.arch),
        zdr: opts.zdr ? "true" : undefined,
        region: stringOpt(opts.region),
      };
      const result = await client().models(query, Boolean(opts.eligible));
      const rows = Array.isArray(result.data) ? result.data : [];
      console.log(renderList(result, rows, format()));
    });
  models
    .command("get <model>")
    .description("Get one model by author/slug")
    .action(async (model: string) => console.log(renderObject(await client().model(model), format())));
  models
    .command("endpoints <model>")
    .description("List provider endpoints for one author/slug model")
    .action(async (model: string) =>
      console.log(renderObject(await client().modelEndpoints(model), format())),
    );

  const providers = program.command("providers").description("Inspect OpenRouter providers");
  providers
    .command("list")
    .description("List provider slugs and metadata")
    .action(async () => {
      const result = await client().providers();
      console.log(renderList(result, Array.isArray(result.data) ? result.data : [], format()));
    });

  program
    .command("key")
    .description("Show current key limits and usage without exposing the secret")
    .action(async () => console.log(renderObject(await client().key(), format())));

  program
    .command("generation <id>")
    .description("Get request, provider, token, timing, and cost metadata for a generation")
    .action(async (id: string) => console.log(renderObject(await client().generation(id), format())));

  program
    .command("chat")
    .description("Create a billable chat completion")
    .option("--model <slug>", "Model slug. Required unless supplied by --request")
    .option("--prompt <text>", "User prompt. Required unless supplied by --request")
    .option("--system <text>", "Optional system prompt")
    .option("--request <path>", "Full JSON request body from a file, or - for stdin")
    .option("--max-completion-tokens <n>", "Completion cap; defaults to 2048")
    .option("--temperature <n>", "Sampling temperature from 0 to 2")
    .option("--provider <slug>", "Preferred provider slug; repeatable", collect, [])
    .option("--require-parameters", "Only route to providers supporting every request parameter")
    .option("--zdr", "Only route to zero-data-retention endpoints")
    .option("--session-id <id>", "Sticky routing and observability session id")
    .option("--user <id>", "Stable end-user identifier")
    .option("--stream", "Request SSE streaming; Mirage still materializes command output")
    .action(async (opts: ChatOptions) => runChat(client(), opts, format()));

  program.addHelpText(
    "after",
    `
Examples:
  openrouter models list --supports tools --sort pricing-low-to-high -f table
  openrouter key
  openrouter chat --model anthropic/claude-sonnet-4.6 --prompt "Summarize this"
  openrouter chat --request /data/openrouter-request.json
  cat /data/openrouter-request.json | openrouter chat --request -

Auth: OPENROUTER_API_KEY or --api-key. Chat is billable and should be write-gated in Mirage.
`,
  );
  return program;
}

async function runChat(client: OpenRouterClient, opts: ChatOptions, format: Format): Promise<void> {
  const request = opts.request ? await readRequest(opts.request) : ({} as ChatRequest);
  if (opts.prompt && opts.request) throw new Error("Use either --prompt or --request, not both.");
  if (opts.prompt) {
    request.messages = [
      ...(opts.system ? [{ role: "system", content: opts.system }] : []),
      { role: "user", content: opts.prompt },
    ];
  }
  if (opts.model) request.model = opts.model;
  if (!request.model && (!Array.isArray(request.models) || request.models.length === 0)) {
    throw new Error("A model is required. Pass --model <author/slug> or include model/models in --request.");
  }
  if (!Array.isArray(request.messages) && typeof request.prompt !== "string") {
    throw new Error("A prompt is required. Pass --prompt or include messages/prompt in --request.");
  }
  request.max_completion_tokens =
    numberOpt(opts.maxCompletionTokens) ?? request.max_completion_tokens ?? 2048;
  if (opts.temperature !== undefined) request.temperature = requiredNumber(opts.temperature, "temperature");
  if (opts.sessionId) request.session_id = opts.sessionId;
  if (opts.user) request.user = opts.user;
  const provider = isRecord(request.provider) ? { ...request.provider } : {};
  if (opts.provider.length > 0) provider.order = opts.provider;
  if (opts.requireParameters) provider.require_parameters = true;
  if (opts.zdr) provider.zdr = true;
  if (Object.keys(provider).length > 0) request.provider = provider;

  const wantsStream = opts.stream || request.stream === true;
  if (!wantsStream) {
    const response = await client.chat(request);
    assertCompletionSucceeded(response);
    console.log(format === "text" ? responseText(response) : renderObject(response, format));
    return;
  }

  let wroteText = false;
  const result = await client.streamChat(request, (chunk) => {
    if (format === "jsonl") console.log(JSON.stringify(chunk));
    if (format === "text") {
      const text = chunk.choices?.map((choice) => choice.delta?.content ?? "").join("") ?? "";
      if (text) {
        wroteText = true;
        process.stdout.write(text);
      }
    }
  });
  if (format === "text") {
    if (wroteText) process.stdout.write("\n");
    return;
  }
  if (format === "jsonl") return;
  console.log(renderObject(result, format));
}

function assertCompletionSucceeded(response: ChatResponse): void {
  if (response.error) {
    throw new ApiError(
      typeof response.error.code === "number" ? response.error.code : 200,
      response.error.message ?? "OpenRouter completion failed",
      response.error.metadata,
    );
  }
  const failed = response.choices?.find((choice) => choice.finish_reason === "error" || choice.error);
  if (failed) {
    throw new ApiError(
      typeof failed.error?.code === "number" ? failed.error.code : 200,
      failed.error?.message ?? "OpenRouter completion ended with finish_reason=error",
      failed.error?.metadata,
    );
  }
}

function responseText(response: ChatResponse): string {
  const text = response.choices?.map((choice) => choice.message?.content ?? "").join("\n") ?? "";
  return text || JSON.stringify(response, null, 2);
}

async function readRequest(path: string): Promise<ChatRequest> {
  const raw = path === "-" ? await readStdin() : await readFile(path);
  const value = JSON.parse(raw) as unknown;
  if (!isRecord(value)) throw new Error("OpenRouter request JSON must be an object.");
  return value as ChatRequest;
}

async function readFile(path: string): Promise<string> {
  const bridge = (
    globalThis as typeof globalThis & {
      __MIRAGE_CLI_FILE_IO__?: {
        canHandle(path: unknown): boolean;
        readFileSync(path: unknown, options?: unknown): string | Uint8Array | null;
      };
    }
  ).__MIRAGE_CLI_FILE_IO__;
  if (bridge?.canHandle(path)) {
    const value = bridge.readFileSync(path, "utf8");
    if (typeof value === "string") return value;
    if (value instanceof Uint8Array) return new TextDecoder().decode(value);
    throw new Error(`Mirage VFS request file not found: ${path}`);
  }
  const { readFileSync } = await import("node:fs");
  return readFileSync(path, "utf8");
}

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin as unknown as AsyncIterable<Uint8Array | string>) {
    chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
  }
  let size = 0;
  for (const chunk of chunks) size += chunk.byteLength;
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

function collect(value: string, values: string[]): string[] {
  return [...values, value];
}

function stringOpt(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function numberOpt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function requiredNumber(value: unknown, name: string): number {
  const number = numberOpt(value);
  if (number === undefined) throw new Error(`${name} must be a finite number.`);
  return number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
