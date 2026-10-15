import { afterEach, describe, expect, test } from "bun:test";
import { buildProgram } from "../src/cli.ts";

const originalFetch = globalThis.fetch;
const originalLog = console.log;
const originalKey = process.env.OPENROUTER_API_KEY;

type Bridge = {
  canHandle(path: unknown): boolean;
  readFileSync(path: unknown, options?: unknown): string | Uint8Array | null;
};

function installFiles(files: Record<string, string | Uint8Array>): void {
  (globalThis as typeof globalThis & { __MIRAGE_CLI_FILE_IO__?: Bridge }).__MIRAGE_CLI_FILE_IO__ = {
    canHandle: (path) => typeof path === "string" && path in files,
    readFileSync: (path, options) => {
      const value = files[String(path)];
      if (value === undefined) return null;
      if (options === "utf8" && value instanceof Uint8Array) return new TextDecoder().decode(value);
      return value;
    },
  };
}

const ANSWERS = {
  answers: {
    urgent: { type: "noul", noul: 0.96 },
    team: { type: "choice", choice: "billing", confidence: 0.75, probabilities: { billing: 0.84, tech: 0.16 } },
    severity: {
      type: "score",
      score: 1.99,
      confidence: 0.99,
      legend: { "0": "Low", "1": "Medium", "2": "High" },
      probabilities: { "0": 0, "1": 0.01, "2": 0.99 },
    },
  },
  model: "typesafe/jev-1.14-20261014",
  usage: { cost: 0.00002, input_tokens: 476, output_tokens: 70 },
};

const QUESTIONS = {
  urgent: { type: "noul", instructions: "Is this urgent?", criteria: { true: "Now", false: "Later" } },
};

function captureFetch(): { calls: Array<{ url: string; body: Record<string, unknown> }> } {
  const seen = { calls: [] as Array<{ url: string; body: Record<string, unknown> }> };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(ANSWERS), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return seen;
}

function captureLog(): string[] {
  const lines: string[] = [];
  console.log = (value: unknown) => lines.push(String(value));
  return lines;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalLog;
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
  delete (globalThis as typeof globalThis & { __MIRAGE_CLI_FILE_IO__?: unknown }).__MIRAGE_CLI_FILE_IO__;
});

describe("openrouter decisions", () => {
  test("posts state and questions to /api/alpha/decisions and prints one line per answer", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    installFiles({ "/data/q.json": JSON.stringify(QUESTIONS) });
    const seen = captureFetch();
    const out = captureLog();

    await buildProgram().parseAsync([
      "node", "openrouter", "-f", "text", "decisions",
      "--model", "typesafe/jev-1.14",
      "--state", "Payouts failing for 3 days",
      "--questions", "/data/q.json",
    ]);

    expect(seen.calls).toHaveLength(1);
    expect(new URL(seen.calls[0]!.url).pathname).toBe("/api/alpha/decisions");
    expect(seen.calls[0]!.body).toEqual({
      model: "typesafe/jev-1.14",
      state: "Payouts failing for 3 days",
      questions: QUESTIONS,
    });
    expect(out.join("\n").split("\n")).toEqual([
      "urgent\tnoul\t0.96",
      "team\tchoice\tbilling\tconfidence=0.75",
      "severity\tscore\t1.99\tHigh\tconfidence=0.99",
    ]);
  });

  test("sends a JSON state file as structured state and appends images after it", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    installFiles({
      "/data/state.json": '{"ticket":"blank checkout","tier":"enterprise"}',
      "/data/q.json": JSON.stringify(QUESTIONS),
      "/data/shot.png": new Uint8Array([137, 80, 78, 71]),
    });
    const seen = captureFetch();
    captureLog();

    await buildProgram().parseAsync([
      "node", "openrouter", "decisions",
      "--model", "typesafe/jev-1.14",
      "--state-file", "/data/state.json",
      "--questions", "/data/q.json",
      "--image", "/data/shot.png",
    ]);

    const state = seen.calls[0]!.body.state as unknown[];
    expect(state[0]).toEqual({ ticket: "blank checkout", tier: "enterprise" });
    expect(state[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,iVBORw==" } });
  });

  test("a full --request body is sent as-is, with --model overriding its model", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    installFiles({
      "/data/req.json": JSON.stringify({ model: "typesafe/jev-1.13", state: "x", questions: QUESTIONS }),
    });
    const seen = captureFetch();
    captureLog();

    await buildProgram().parseAsync([
      "node", "openrouter", "decisions", "--request", "/data/req.json", "--model", "typesafe/jev-1.14",
    ]);

    expect(seen.calls[0]!.body).toEqual({ model: "typesafe/jev-1.14", state: "x", questions: QUESTIONS });
  });

  test("refuses before any billable call when model, state or questions are missing", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    installFiles({ "/data/q.json": JSON.stringify(QUESTIONS) });
    const seen = captureFetch();
    captureLog();

    await expect(
      buildProgram().parseAsync(["node", "openrouter", "decisions", "--state", "x", "--questions", "/data/q.json"]),
    ).rejects.toThrow(/model is required/);
    await expect(
      buildProgram().parseAsync(["node", "openrouter", "decisions", "--model", "a/b", "--questions", "/data/q.json"]),
    ).rejects.toThrow(/State is required/);
    await expect(
      buildProgram().parseAsync(["node", "openrouter", "decisions", "--model", "a/b", "--state", "x"]),
    ).rejects.toThrow(/Questions are required/);
    expect(seen.calls).toHaveLength(0);
  });
});
