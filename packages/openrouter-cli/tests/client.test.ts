import { describe, expect, test } from "bun:test";
import { ApiError, OpenRouterClient } from "../src/client.ts";

function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

describe("OpenRouterClient", () => {
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
