import { Command } from "commander";
import { Buffer } from "node:buffer";
import {
  ApiError,
  type ChatRequest,
  type ChatResponse,
  type ImageGenerationRequest,
  type ImageGenerationResponse,
  type ImageReference,
  type JsonRecord,
  OpenRouterClient,
  type Query,
} from "./client.ts";
import { resolveConfig } from "./config.ts";
import { parseFormat, renderList, renderObject, type Format } from "./output.ts";

const VERSION = "0.2.0";

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

interface ImageGenerateOptions {
  model?: string;
  prompt?: string;
  request?: string;
  output?: string;
  size?: string;
  resolution?: string;
  aspectRatio?: string;
  quality?: string;
  outputFormat?: string;
  background?: string;
  outputCompression?: string;
  seed?: string;
  reference: string[];
}

interface MirageFileIoBridge {
  canHandle(path: unknown): boolean;
  readFileSync(path: unknown, options?: unknown): string | Uint8Array | null;
  writeFileSync?(path: unknown, data: unknown, options?: unknown): boolean;
}

interface PreparedImage {
  path: string;
  media_type: string;
  bytes: Uint8Array;
}

const MAX_GENERATED_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_REFERENCE_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_REFERENCE_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_REFERENCE_IMAGES = 4;

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

  const images = program.command("images").description("Discover and generate images with OpenRouter");
  images
    .command("models")
    .description("List models available through the dedicated Images API")
    .action(async () => {
      const result = await client().imageModels();
      console.log(renderList(result, Array.isArray(result.data) ? result.data : [], format()));
    });
  images
    .command("endpoints <model>")
    .description("List provider endpoints, capabilities, and pricing for an image model")
    .action(async (model: string) =>
      console.log(renderObject(await client().imageModelEndpoints(model), format())),
    );
  images
    .command("generate")
    .description("Generate one image, write it to a file, and print a compact receipt")
    .option("--model <slug>", "Explicit image model slug (required)")
    .option("--prompt <text>", "Image prompt. Required unless supplied by --request")
    .option("--request <path>", "Full Images API JSON body from a file, or - for stdin")
    .option("--output <path>", "Destination image file, such as /sessions/<id>/image.png (required)")
    .option("--size <size>", "Resolution tier or explicit dimensions, such as 1024x1024")
    .option("--resolution <tier>", "Resolution tier, such as 1K, 2K, or 4K")
    .option("--aspect-ratio <ratio>", "Aspect ratio, such as 1:1 or 16:9")
    .option("--quality <quality>", "Provider quality setting, such as low, medium, or high")
    .option("--output-format <format>", "png, jpeg, webp, or another model-supported format")
    .option("--background <mode>", "auto, transparent, or opaque")
    .option("--output-compression <n>", "JPEG/WebP compression from 0 to 100")
    .option("--seed <n>", "Deterministic seed when supported")
    .option(
      "--reference <url-or-path>",
      "Reference image URL, data URL, or local/mounted path; repeatable",
      collect,
      [],
    )
    .action(async (opts: ImageGenerateOptions) => runImageGeneration(client(), opts, format()));

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
  openrouter images models -f table
  openrouter images endpoints openai/gpt-image-1-mini
  openrouter images generate --model openai/gpt-image-1-mini --prompt "A blue orchid" --output /sessions/<id>/orchid.png
  openrouter key
  openrouter chat --model anthropic/claude-sonnet-4.6 --prompt "Summarize this"
  openrouter chat --request /data/openrouter-request.json
  cat /data/openrouter-request.json | openrouter chat --request -

Auth: OPENROUTER_API_KEY or --api-key. Chat and images generate are billable and should be write-gated in Mirage.
`,
  );
  return program;
}

async function runImageGeneration(
  client: OpenRouterClient,
  opts: ImageGenerateOptions,
  format: Format,
): Promise<void> {
  if (!opts.model) throw new Error("An explicit image model is required. Pass --model <author/slug>.");
  if (!opts.output) throw new Error("An image output path is required. Pass --output <path>.");
  const requestValue = opts.request ? await readJsonRequest(opts.request) : {};
  if (opts.prompt && opts.request) throw new Error("Use either --prompt or --request, not both.");
  const request = requestValue as Partial<ImageGenerationRequest> & JsonRecord;
  request.model = opts.model;
  if (opts.prompt) request.prompt = opts.prompt;
  if (typeof request.prompt !== "string" || request.prompt.trim() === "") {
    throw new Error("A prompt is required. Pass --prompt or include prompt in --request.");
  }
  if (request.n !== undefined && request.n !== 1) {
    throw new Error("Image generation currently supports exactly one image per command; set n to 1.");
  }
  request.n = 1;
  request.stream = false;
  if (opts.size) request.size = opts.size;
  if (opts.resolution) request.resolution = opts.resolution;
  if (opts.aspectRatio) request.aspect_ratio = opts.aspectRatio;
  if (opts.quality) request.quality = opts.quality;
  if (opts.outputFormat) request.output_format = opts.outputFormat;
  if (opts.background) request.background = opts.background;
  if (opts.outputCompression !== undefined) {
    const compression = requiredInteger(opts.outputCompression, "output-compression");
    if (compression < 0 || compression > 100) {
      throw new Error("output-compression must be between 0 and 100.");
    }
    request.output_compression = compression;
  }
  if (opts.seed !== undefined) request.seed = requiredInteger(opts.seed, "seed");
  if (request.input_references !== undefined || opts.reference.length > 0) {
    request.input_references = await normalizeImageReferences(
      request.input_references,
      opts.reference,
    );
  }

  const response = await client.generateImages(request as ImageGenerationRequest);
  const prepared = prepareGeneratedImages(response, opts.output, request.output_format);
  for (const image of prepared) await writeFile(image.path, image.bytes);

  const receipt = {
    model: request.model,
    created: response.created,
    files: prepared.map((image) => ({
      path: image.path,
      media_type: image.media_type,
      bytes: image.bytes.byteLength,
    })),
    ...(response.usage === undefined ? {} : { usage: response.usage }),
  };
  if (format === "text") {
    console.log(prepared.map((image) => image.path).join("\n"));
    return;
  }
  console.log(renderObject(receipt, format));
}

function prepareGeneratedImages(
  response: ImageGenerationResponse,
  output: string,
  requestedFormat: unknown,
): PreparedImage[] {
  if (!Number.isFinite(response.created)) {
    throw new Error("OpenRouter image response is missing a valid created timestamp.");
  }
  if (!Array.isArray(response.data) || response.data.length !== 1) {
    throw new Error("OpenRouter image response must contain exactly one data image.");
  }

  return response.data.map((image) => {
    if (!isRecord(image) || typeof image.b64_json !== "string" || image.b64_json === "") {
      throw new Error("OpenRouter image response contains an invalid b64_json image payload.");
    }
    const mediaType = normalizedImageMediaType(image.media_type, requestedFormat);
    return {
      path: output,
      media_type: mediaType,
      bytes: decodeGeneratedImage(image.b64_json),
    };
  });
}

function decodeGeneratedImage(value: string): Uint8Array {
  return decodeBase64(value, MAX_GENERATED_IMAGE_BYTES, "Generated image");
}

function normalizedImageMediaType(mediaType: unknown, requestedFormat: unknown): string {
  const value = typeof mediaType === "string" && mediaType !== ""
    ? mediaType.toLowerCase()
    : mediaTypeForFormat(requestedFormat) ?? "image/png";
  if (!/^image\/[a-z0-9.+-]+$/.test(value)) {
    throw new Error(`OpenRouter returned an invalid image media type: ${String(mediaType)}`);
  }
  return value;
}

function mediaTypeForFormat(format: unknown): string | undefined {
  if (typeof format !== "string") return undefined;
  const normalized = format.toLowerCase();
  if (normalized === "jpg" || normalized === "jpeg") return "image/jpeg";
  if (normalized === "svg") return "image/svg+xml";
  if (normalized === "png" || normalized === "webp") return `image/${normalized}`;
  return undefined;
}

async function toImageReference(value: string): Promise<ImageReference> {
  if (/^https?:\/\//i.test(value) || /^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) {
    return { type: "image_url", image_url: { url: value } };
  }
  const mediaType = mediaTypeForPath(value);
  if (!mediaType) {
    throw new Error(`Cannot infer image type for reference ${value}; use png, jpg, webp, gif, or svg.`);
  }
  const bytes = await readFileBytes(value);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error(`Reference image ${value} is empty or exceeds ${MAX_REFERENCE_IMAGE_BYTES} bytes.`);
  }
  return {
    type: "image_url",
    image_url: { url: `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}` },
  };
}

async function normalizeImageReferences(
  requestReferences: unknown,
  cliReferences: string[],
): Promise<ImageReference[]> {
  const references: ImageReference[] = [];
  if (requestReferences !== undefined) {
    if (!Array.isArray(requestReferences)) {
      throw new Error("input_references in --request must be an array.");
    }
    for (const entry of requestReferences) {
      if (
        !isRecord(entry) ||
        entry.type !== "image_url" ||
        !isRecord(entry.image_url) ||
        typeof entry.image_url.url !== "string"
      ) {
        throw new Error("Each input_references entry must be an image_url with a string url.");
      }
      references.push({ type: "image_url", image_url: { url: entry.image_url.url } });
    }
  }
  for (const value of cliReferences) references.push(await toImageReference(value));
  if (references.length > MAX_REFERENCE_IMAGES) {
    throw new Error(`At most ${MAX_REFERENCE_IMAGES} reference images are allowed per command.`);
  }

  let totalBytes = 0;
  for (const reference of references) {
    const url = reference.image_url.url;
    const data = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(url);
    if (data) {
      totalBytes += decodeBase64(
        data[2] ?? "",
        MAX_REFERENCE_IMAGE_BYTES,
        "Reference image",
      ).byteLength;
      continue;
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("Reference image URLs must use http(s) or a base64 image data URL.");
    }
  }
  if (totalBytes > MAX_REFERENCE_TOTAL_BYTES) {
    throw new Error(`Reference images exceed the ${MAX_REFERENCE_TOTAL_BYTES} byte aggregate limit.`);
  }
  return references;
}

function decodeBase64(value: string, maxBytes: number, label: string): Uint8Array {
  if (value.length > Math.ceil(maxBytes / 3) * 4 + 4) {
    throw new Error(`${label} exceeds the ${maxBytes} byte safety limit.`);
  }
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error(`${label} contains malformed base64 data.`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
    throw new Error(`${label} is empty or exceeds the ${maxBytes} byte safety limit.`);
  }
  return bytes;
}

function mediaTypeForPath(path: string): string | undefined {
  const clean = path.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  if (clean.endsWith(".png")) return "image/png";
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "image/jpeg";
  if (clean.endsWith(".webp")) return "image/webp";
  if (clean.endsWith(".gif")) return "image/gif";
  if (clean.endsWith(".svg")) return "image/svg+xml";
  return undefined;
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
  return await readJsonRequest(path) as ChatRequest;
}

async function readJsonRequest(path: string): Promise<JsonRecord> {
  const raw = path === "-" ? await readStdin() : await readFile(path);
  const value = JSON.parse(raw) as unknown;
  if (!isRecord(value)) throw new Error("OpenRouter request JSON must be an object.");
  return value;
}

function fileIoBridge(): MirageFileIoBridge | undefined {
  return (
    globalThis as typeof globalThis & { __MIRAGE_CLI_FILE_IO__?: MirageFileIoBridge }
  ).__MIRAGE_CLI_FILE_IO__;
}

async function readFile(path: string): Promise<string> {
  const bridge = fileIoBridge();
  if (bridge?.canHandle(path)) {
    const value = bridge.readFileSync(path, "utf8");
    if (typeof value === "string") return value;
    if (value instanceof Uint8Array) return new TextDecoder().decode(value);
    throw new Error(`Mirage VFS request file not found: ${path}`);
  }
  const { readFileSync } = await import("node:fs");
  return readFileSync(path, "utf8");
}

async function readFileBytes(path: string): Promise<Uint8Array> {
  const bridge = fileIoBridge();
  if (bridge?.canHandle(path)) {
    const value = bridge.readFileSync(path);
    if (value instanceof Uint8Array) return value;
    if (typeof value === "string") return new TextEncoder().encode(value);
    throw new Error(`Mirage VFS file not found: ${path}`);
  }
  const { readFileSync } = await import("node:fs");
  return readFileSync(path);
}

async function writeFile(path: string, bytes: Uint8Array): Promise<void> {
  const bridge = fileIoBridge();
  if (bridge?.canHandle(path)) {
    if (bridge.writeFileSync?.(path, bytes)) return;
    throw new Error(`Mirage VFS refused to write generated image: ${path}`);
  }
  const [{ dirname }, { mkdirSync, writeFileSync }] = await Promise.all([
    import("node:path"),
    import("node:fs"),
  ]);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
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

function requiredInteger(value: unknown, name: string): number {
  const number = requiredNumber(value, name);
  if (!Number.isInteger(number)) throw new Error(`${name} must be an integer.`);
  return number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
