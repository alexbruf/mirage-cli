import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { runCommander } from "@mirage-cli/core";
import { OpenRouterClient } from "../src/client.ts";

/**
 * OpenRouter is the only paid CLI here whose charge cannot be read at the
 * fetch: on a streamed completion the usage arrives on a trailing SSE chunk,
 * long after the response headers. These tests pin that both shapes report,
 * and that a rejected call still leaves a trace.
 */

function client(fetchFn: typeof fetch): OpenRouterClient {
  return new OpenRouterClient({ apiKey: "test", fetch: fetchFn });
}

/** Run `fn` inside a cost scope, the way a mirage command would. */
async function scoped(fn: () => Promise<unknown>) {
  const program = new Command();
  program.name("p");
  program.command("go").action(async () => {
    try {
      await fn();
    } catch {
      /* the report must already have happened */
    }
  });
  return runCommander(program, ["go"]);
}

const json = (body: unknown, status = 200) =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;

function sse(lines: string[], status = 200): typeof fetch {
  return (async () =>
    new Response(
      new ReadableStream({
        start(c) {
          for (const l of lines) c.enqueue(new TextEncoder().encode(`data: ${l}\n\n`));
          c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          c.close();
        },
      }),
      { status, headers: { "Content-Type": "text/event-stream" } },
    )) as unknown as typeof fetch;
}

describe("openrouter cost reporting", () => {
  test("reports usd and tokens from a non-streamed completion", async () => {
    const c = client(
      json({
        model: "anthropic/claude-sonnet-4",
        usage: { prompt_tokens: 120, completion_tokens: 45, cost: 0.00231 },
        choices: [],
      }),
    );
    const r = await scoped(() => c.chat({ model: "anthropic/claude-sonnet-4", prompt: "hi" }));
    expect(r.costs).toEqual([
      {
        provider: "openrouter",
        usd: 0.00231,
        model: "anthropic/claude-sonnet-4",
        promptTokens: 120,
        completionTokens: 45,
        statusCode: 200,
      },
    ]);
  });

  test("reports tokens even when the account returns no cost figure", async () => {
    const c = client(json({ model: "x/y", usage: { prompt_tokens: 10, completion_tokens: 2 } }));
    const r = await scoped(() => c.chat({ model: "x/y", prompt: "hi" }));
    expect(r.costs[0]).toMatchObject({ usd: null, promptTokens: 10, completionTokens: 2 });
  });

  test("reports image generation, which bills like a completion", async () => {
    const c = client(
      json({ created: 1, data: [], usage: { prompt_tokens: 5, completion_tokens: 0, cost: 0.04 } }),
    );
    const r = await scoped(() => c.generateImages({ model: "g/i", prompt: "a cat" }));
    expect(r.costs[0]).toMatchObject({ provider: "openrouter", usd: 0.04 });
  });

  test("reports a streamed completion from its trailing usage chunk", async () => {
    const c = client(
      sse([
        JSON.stringify({ model: "a/b", choices: [{ delta: { content: "hi" } }] }),
        JSON.stringify({ usage: { prompt_tokens: 7, completion_tokens: 3, cost: 0.0009 } }),
      ]),
    );
    const r = await scoped(() => c.streamChat({ model: "a/b", prompt: "hi" }));
    expect(r.costs[0]).toMatchObject({
      provider: "openrouter",
      usd: 0.0009,
      model: "a/b",
      promptTokens: 7,
      completionTokens: 3,
    });
  });

  test("records a rejected call with no amount rather than nothing", async () => {
    const c = client(json({ error: { message: "no credits" } }, 402));
    const r = await scoped(() => c.chat({ model: "a/b", prompt: "hi" }));
    expect(r.costs).toEqual([
      {
        provider: "openrouter",
        usd: null,
        model: "a/b",
        promptTokens: null,
        completionTokens: null,
        statusCode: 402,
      },
    ]);
  });

  test("does not report free metadata reads", async () => {
    const c = client(json({ data: [] }));
    const r = await scoped(() => c.models());
    expect(r.costs).toEqual([]);
  });
});
