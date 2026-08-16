// DataForSEO reports failure inside an HTTP 200: the envelope says
// `status_code: 20000, "Ok."` and the real outcome sits per task. Nothing
// looked at it, and `extractItems` skips a task whose `result` is not an array
// — which is exactly what a failed task looks like — so callers got `[]` and
// exit 0. These pin the fix: a failure has to reach the caller as an error.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { assertResponseOk, call, type DfsResponse, get } from "../../src/lib/client.ts";

/** The exact envelope the live API returned for the reported bug. */
function badLocationCode(): DfsResponse {
  return {
    status_code: 20_000,
    status_message: "Ok.",
    tasks_error: 1,
    tasks: [
      {
        status_code: 40_501,
        status_message: "Invalid Field: 'location_code'.",
        result: null,
      },
    ],
  };
}

/** Capture console.error for the partial-failure warning path. */
function captureStderr(fn: () => void): string[] {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.error = original;
  }
  return lines;
}

describe("assertResponseOk", () => {
  test("throws on the reported bug: a 200 whose only task failed", () => {
    expect(() => assertResponseOk(badLocationCode())).toThrow(
      "DataForSEO error 40501: Invalid Field: 'location_code'.",
    );
  });

  test("throws when the envelope status itself is a failure", () => {
    expect(() =>
      assertResponseOk({ status_code: 40_400, status_message: "Not Found." }),
    ).toThrow("DataForSEO error 40400: Not Found.");
  });

  test("names rejected credentials", () => {
    expect(() =>
      assertResponseOk({
        status_code: 20_000,
        tasks: [{ status_code: 40_100, status_message: "Invalid Login/Password." }],
      }),
    ).toThrow("DataForSEO error 40100: Invalid Login/Password. (the API rejected these credentials)");
  });

  test("names an exhausted balance, for both codes that mean it", () => {
    for (const code of [40_200, 40_210]) {
      expect(() =>
        assertResponseOk({
          status_code: 20_000,
          tasks: [{ status_code: code, status_message: "Payment Required." }],
        }),
      ).toThrow("(the account balance is exhausted)");
    }
  });

  test("does not label a code that merely neighbours the ones we name", () => {
    // 40201/40202 are holds and subscription problems, not balance. Bucketing
    // by numeric family would mislabel them.
    let message = "";
    try {
      assertResponseOk({
        status_code: 20_000,
        tasks: [{ status_code: 40_202, status_message: "Some other 402." }],
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe("DataForSEO error 40202: Some other 402.");
    expect(message).not.toContain("balance");
  });

  test("a successful response with zero results stays silent", () => {
    // This is the case the old silent-empty behaviour existed to serve.
    expect(() =>
      assertResponseOk({
        status_code: 20_000,
        status_message: "Ok.",
        tasks: [{ status_code: 20_000, status_message: "Ok.", result: [] }],
      }),
    ).not.toThrow();
  });

  test("a response with no tasks at all is fine", () => {
    expect(() => assertResponseOk({ status_code: 20_000, status_message: "Ok." })).not.toThrow();
  });

  test("a partial batch warns about the failure and keeps the good rows", () => {
    const partial: DfsResponse = {
      status_code: 20_000,
      tasks: [
        { status_code: 20_000, status_message: "Ok.", result: [{ items: [1] }] },
        { status_code: 40_501, status_message: "Invalid Field: 'x'." },
      ],
    };
    const warnings = captureStderr(() => {
      expect(() => assertResponseOk(partial)).not.toThrow();
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("warning: DataForSEO error 40501: Invalid Field: 'x'.");
  });

  test("throws when every task in a batch failed", () => {
    expect(() =>
      assertResponseOk({
        status_code: 20_000,
        tasks: [
          { status_code: 40_501, status_message: "first" },
          { status_code: 40_501, status_message: "second" },
        ],
      }),
    ).toThrow("DataForSEO error 40501: first");
  });
});

// The validator passing its own unit tests proves nothing about whether it is
// actually reachable. A previous attempt at this fix shipped with green unit
// tests and a broken wiring, so these drive the real transport functions with
// a stubbed fetch and assert the failure comes out the other end.
describe("call/get surface a 200 that reports failure", () => {
  const realFetch = globalThis.fetch;
  let priorLogin: string | undefined;
  let priorPassword: string | undefined;

  beforeEach(() => {
    priorLogin = process.env.DATAFORSEO_LOGIN;
    priorPassword = process.env.DATAFORSEO_PASSWORD;
    process.env.DATAFORSEO_LOGIN = "test@example.com";
    process.env.DATAFORSEO_PASSWORD = "test-password";
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (priorLogin === undefined) delete process.env.DATAFORSEO_LOGIN;
    else process.env.DATAFORSEO_LOGIN = priorLogin;
    if (priorPassword === undefined) delete process.env.DATAFORSEO_PASSWORD;
    else process.env.DATAFORSEO_PASSWORD = priorPassword;
  });

  /** HTTP 200 — the transport succeeded. The failure is in the body. */
  function stub200(body: DfsResponse): void {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
  }

  test("call() throws instead of returning a body the caller reads as empty", async () => {
    stub200(badLocationCode());
    await expect(call("/v3/serp/google/organic/live/regular", {})).rejects.toThrow(
      "DataForSEO error 40501: Invalid Field: 'location_code'.",
    );
  });

  test("get() throws too — the same validator runs on both paths", async () => {
    stub200({
      status_code: 20_000,
      tasks: [{ status_code: 40_100, status_message: "Invalid Login/Password." }],
    });
    await expect(get("/v3/appendix/user_data")).rejects.toThrow(
      "(the API rejected these credentials)",
    );
  });

  test("call() still returns a successful empty response untouched", async () => {
    const ok: DfsResponse = {
      status_code: 20_000,
      status_message: "Ok.",
      tasks: [{ status_code: 20_000, status_message: "Ok.", result: [] }],
    };
    stub200(ok);
    expect(await call("/v3/serp/google/organic/live/regular", {})).toMatchObject({
      status_code: 20_000,
    });
  });
});
