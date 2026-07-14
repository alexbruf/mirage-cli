import { describe, expect, test } from "bun:test";
import { ApiError, OpenRouterClient } from "../src/client.ts";

function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

describe("OpenRouterClient", () => {
  test("calls the runtime fetch with the global receiver", async () => {
    const originalFetch = globalThis.fetch;
    let receiver: unknown;
    globalThis.fetch = function (this: typeof globalThis) {
      receiver = this;
      return Promise.resolve(json({ data: { limit_remaining: 10 } }));
    } as unknown as typeof fetch;
    try {
      const result = await new OpenRouterClient({ apiKey: "key" }).key();
      expect(result.data).toEqual({ limit_remaining: 10 });
      expect(receiver).toBe(globalThis);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("adds bearer and attribution headers and model filters", async () => {
    let request: Request | undefined;
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      request = new Request(input, init);
      return json({ data: [] });
    }) as unknown as typeof fetch;
    const client = new OpenRouterClient({
      apiKey: "sk-test",
      httpReferer: "https://example.com",
      appTitle: "Mirage",
      fetch: fetchFn,
    });

    await client.models({ q: "sonnet", supported_parameters: "tools", zdr: true });

    expect(request).toBeDefined();
    expect(request!.headers.get("Authorization")).toBe("Bearer sk-test");
    expect(request!.headers.get("HTTP-Referer")).toBe("https://example.com");
    expect(request!.headers.get("X-OpenRouter-Title")).toBe("Mirage");
    expect(new URL(request!.url).searchParams.get("supported_parameters")).toBe("tools");
    expect(new URL(request!.url).searchParams.get("zdr")).toBe("true");
  });

  test("retries a GET once for a short Retry-After", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return calls === 1
        ? json(
            { error: { code: 429, message: "slow down" } },
            { status: 429, headers: { "Retry-After": "0" } },
          )
        : json({ data: { limit_remaining: 10 } });
    }) as unknown as typeof fetch;
    const result = await new OpenRouterClient({ apiKey: "key", fetch: fetchFn }).key();
    expect(calls).toBe(2);
    expect(result.data).toEqual({ limit_remaining: 10 });
  });

  test("discovers dedicated image models and model endpoints", async () => {
    const requests: Request[] = [];
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      if (new URL(request.url).pathname.endsWith("/endpoints")) {
        return json({
          id: "bytedance-seed/seedream-4.5",
          endpoints: [{
            provider_slug: "seed",
            supports_streaming: false,
            pricing: [{ billable: "output_image", unit: "image", cost_usd: 0.04 }],
          }],
        });
      }
      return json({
        data: [{
          id: "bytedance-seed/seedream-4.5",
          name: "Seedream 4.5",
          supported_parameters: {
            resolution: { type: "enum", values: ["1K", "2K", "4K"] },
          },
          supports_streaming: false,
          endpoints: "/api/v1/images/models/bytedance-seed/seedream-4.5/endpoints",
        }],
      });
    }) as unknown as typeof fetch;
    const client = new OpenRouterClient({ apiKey: "key", fetch: fetchFn });

    const models = await client.imageModels();
    const endpoints = await client.imageModelEndpoints("bytedance-seed/seedream-4.5");

    expect(models.data?.[0]?.id).toBe("bytedance-seed/seedream-4.5");
    expect(models.data?.[0]?.supported_parameters?.resolution).toEqual({
      type: "enum",
      values: ["1K", "2K", "4K"],
    });
    expect(endpoints.endpoints?.[0]?.pricing?.[0]?.cost_usd).toBe(0.04);
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/images/models");
    expect(new URL(requests[1]!.url).pathname).toBe(
      "/api/v1/images/models/bytedance-seed/seedream-4.5/endpoints",
    );
  });

  test("generates images once, forces buffered mode, and preserves the response", async () => {
    let calls = 0;
    let request: Request | undefined;
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      request = new Request(input, init);
      return json({
        created: 1748372400,
        data: [{ b64_json: "aGVsbG8=", media_type: "image/png" }],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 10,
          total_tokens: 10,
          cost: 0.04,
        },
      });
    }) as unknown as typeof fetch;
    const client = new OpenRouterClient({ apiKey: "key", fetch: fetchFn });

    const result = await client.generateImages({
      model: "bytedance-seed/seedream-4.5",
      prompt: "a small blue square",
      n: 1,
      resolution: "1K",
      aspect_ratio: "1:1",
      provider: { only: ["seed"], allow_fallbacks: false },
    });

    expect(calls).toBe(1);
    expect(new URL(request!.url).pathname).toBe("/api/v1/images");
    expect(await request!.json()).toEqual({
      model: "bytedance-seed/seedream-4.5",
      prompt: "a small blue square",
      n: 1,
      resolution: "1K",
      aspect_ratio: "1:1",
      provider: { only: ["seed"], allow_fallbacks: false },
      stream: false,
    });
    expect(result.data[0]).toEqual({ b64_json: "aGVsbG8=", media_type: "image/png" });
    expect(result.usage?.cost).toBe(0.04);
  });

  test("does not retry billable image generation and preserves typed errors", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return json(
        {
          error: {
            code: 502,
            message: "Provider failed",
            metadata: { error_type: "provider_unavailable", provider_code: "upstream_error" },
          },
        },
        { status: 502, headers: { "Retry-After": "0" } },
      );
    }) as unknown as typeof fetch;
    const client = new OpenRouterClient({ apiKey: "key", fetch: fetchFn });
    try {
      await client.generateImages({ model: "openai/gpt-image-1-mini", prompt: "test" });
      throw new Error("expected image generation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(502);
      expect((error as ApiError).errorType).toBe("provider_unavailable");
      expect((error as ApiError).metadata?.provider_code).toBe("upstream_error");
    }
    expect(calls).toBe(1);
  });

  test("does not retry billable chat and preserves typed errors", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return json(
        {
          error: {
            code: 402,
            message: "Insufficient credits",
            metadata: { error_type: "payment_required" },
          },
        },
        { status: 402 },
      );
    }) as unknown as typeof fetch;
    const client = new OpenRouterClient({ apiKey: "key", fetch: fetchFn });
    try {
      await client.chat({ model: "openai/gpt-4o", messages: [] });
      throw new Error("expected chat to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(402);
      expect((error as ApiError).errorType).toBe("payment_required");
    }
    expect(calls).toBe(1);
  });

  test("parses SSE comments, chunks, final usage, and generation id", async () => {
    const sse = [
      ": OPENROUTER PROCESSING\n\n",
      'data: {"id":"gen-1","model":"openai/gpt-4o","choices":[{"delta":{"content":"Hel"},"finish_reason":null}]}\n\n',
      'data: {"id":"gen-1","model":"openai/gpt-4o","choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\n',
      'data: {"id":"gen-1","model":"openai/gpt-4o","choices":[],"usage":{"total_tokens":3,"cost":0.001}}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    const seen: string[] = [];
    const fetchFn = (async () =>
      new Response(sse, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "X-Generation-Id": "gen-1",
        },
      })) as unknown as typeof fetch;
    const client = new OpenRouterClient({ apiKey: "key", fetch: fetchFn });
    const result = await client.streamChat(
      { model: "openai/gpt-4o", messages: [{ role: "user", content: "hi" }] },
      (chunk) => seen.push(chunk.choices?.[0]?.delta?.content ?? ""),
    );
    expect(seen.join("")).toBe("Hello");
    expect(result.usage).toEqual({ total_tokens: 3, cost: 0.001 });
    expect(result.generationId).toBe("gen-1");
    expect(result.chunks).toHaveLength(3);
  });

  test("treats an HTTP 200 mid-stream error chunk as failure", async () => {
    const sse =
      'data: {"id":"gen-1","error":{"code":429,"message":"Rate limited","metadata":{"error_type":"rate_limit_exceeded"}},"choices":[{"delta":{"content":""},"finish_reason":"error"}]}\n\n';
    const fetchFn = (async () =>
      new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } })) as unknown as typeof fetch;
    const client = new OpenRouterClient({ apiKey: "key", fetch: fetchFn });
    try {
      await client.streamChat({ model: "openai/gpt-4o", messages: [] });
      throw new Error("expected stream to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(429);
      expect((error as ApiError).errorType).toBe("rate_limit_exceeded");
    }
  });
});
