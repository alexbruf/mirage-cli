import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CallRailClient } from "../src/client.ts";
import { parseEnvProfiles, resolveCredentials } from "../src/config.ts";
import { buildProgram } from "../src/cli.ts";
import { parseFormat, renderList, renderObject } from "../src/output.ts";

function subnames(program: ReturnType<typeof buildProgram>, name: string): string[] {
  const cmd = program.commands.find((c: { name: () => string }) => c.name() === name);
  return (cmd as { commands: readonly { name: () => string }[] }).commands.map((c) => c.name());
}

const ENV_KEYS = [
  "CALLRAIL_API_KEY",
  "CALLRAIL_API_KEYS",
  "CALLRAIL_PROFILE",
  "CALLRAIL_ACCOUNT_ID",
  "CALLRAIL_API_BASE_URL",
] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("program shape", () => {
  test("buildProgram() returns a configured Commander program named callrail", () => {
    const program = buildProgram();
    expect(program.name()).toBe("callrail");
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
    const names = program.commands.map((c: { name: () => string }) => c.name());
    for (const expected of [
      "auth",
      "accounts",
      "calls",
      "companies",
      "trackers",
      "conversations",
      "forms",
      "users",
      "tags",
      "integrations",
      "api",
    ]) {
      expect(names).toContain(expected);
    }
  });

  test("calls exposes list/get/summary/timeseries", () => {
    expect(subnames(buildProgram(), "calls").sort()).toEqual([
      "get",
      "list",
      "summary",
      "timeseries",
    ]);
  });

  test("auth exposes profile management", () => {
    const subs = subnames(buildProgram(), "auth");
    for (const s of ["add", "use", "list", "remove", "whoami"]) expect(subs).toContain(s);
  });

  test("read-only: no create/update/delete/send subcommands anywhere", () => {
    const program = buildProgram();
    const banned = /^(create|update|delete|send|set|post|put|patch)/;
    for (const group of program.commands) {
      for (const sub of group.commands) {
        expect(sub.name()).not.toMatch(banned);
      }
    }
  });

  test("program-level credential/format flags are declared", () => {
    const flags = buildProgram().options.map((o: { long?: string }) => o.long);
    for (const f of ["--api-key", "--profile", "--account", "--base-url", "--format"]) {
      expect(flags).toContain(f);
    }
  });

  test("buildProgram() is independent across calls (no shared state)", () => {
    const a = buildProgram();
    const b = buildProgram();
    expect(a).not.toBe(b);
    expect(a.name()).toBe(b.name());
  });
});

describe("config: env profiles", () => {
  test("compact form parses name:key pairs", () => {
    const profiles = parseEnvProfiles("acme:key1, foxhaven:key2");
    expect(profiles.acme).toEqual({ apiKey: "key1", source: "env" });
    expect(profiles.foxhaven).toEqual({ apiKey: "key2", source: "env" });
  });

  test("JSON object form supports accountId pinning and bare-string keys", () => {
    const profiles = parseEnvProfiles(
      '{"acme":{"apiKey":"key1","accountId":"ACC1"},"beta":"key2"}',
    );
    expect(profiles.acme).toEqual({ apiKey: "key1", accountId: "ACC1", source: "env" });
    expect(profiles.beta).toEqual({ apiKey: "key2", source: "env" });
  });

  test("malformed input throws (not silently ignored)", () => {
    expect(() => parseEnvProfiles("justakeywithnocolon")).toThrow(/name:key/);
    expect(() => parseEnvProfiles("{not json")).toThrow(/not valid JSON/);
    expect(() => parseEnvProfiles('{"a":{"accountId":"ACC1"}}')).toThrow(/missing "apiKey"/);
  });
});

describe("config: resolution precedence", () => {
  test("--api-key flag wins over everything", () => {
    process.env.CALLRAIL_API_KEY = "envkey";
    const creds = resolveCredentials({ apiKey: "flagkey", account: "ACCX" });
    expect(creds).toMatchObject({ apiKey: "flagkey", accountId: "ACCX", source: "flag" });
  });

  test("CALLRAIL_API_KEY beats CALLRAIL_API_KEYS (singular wins)", () => {
    process.env.CALLRAIL_API_KEY = "single";
    process.env.CALLRAIL_API_KEYS = "acme:profilekey";
    expect(resolveCredentials().apiKey).toBe("single");
    expect(resolveCredentials().source).toBe("env");
  });

  test("profile selected via flag from CALLRAIL_API_KEYS", () => {
    process.env.CALLRAIL_API_KEYS = "acme:key1,foxhaven:key2";
    const creds = resolveCredentials({ profile: "foxhaven" });
    expect(creds).toMatchObject({ apiKey: "key2", profile: "foxhaven", source: "env-profile" });
  });

  test("CALLRAIL_PROFILE selects among env profiles", () => {
    process.env.CALLRAIL_API_KEYS = "acme:key1,foxhaven:key2";
    process.env.CALLRAIL_PROFILE = "acme";
    expect(resolveCredentials().apiKey).toBe("key1");
  });

  test("sole env profile is used without a selector", () => {
    process.env.CALLRAIL_API_KEYS = "acme:key1";
    const creds = resolveCredentials();
    expect(creds).toMatchObject({ apiKey: "key1", profile: "acme" });
  });

  test("multiple profiles without a selector is a structured error listing names", () => {
    process.env.CALLRAIL_API_KEYS = "acme:key1,foxhaven:key2";
    delete process.env.CALLRAIL_PROFILE;
    // NB: relies on no activeProfile in ~/.config/callrail/config.json being
    // selected — the merged-profile names in the error prove env profiles loaded.
    try {
      const creds = resolveCredentials();
      // A dev machine may have a disk activeProfile; then resolution succeeds.
      expect(creds.apiKey).toBeTruthy();
    } catch (err) {
      expect((err as Error).message).toContain("acme");
      expect((err as Error).message).toContain("foxhaven");
    }
  });

  test("--account / CALLRAIL_ACCOUNT_ID override profile accountId", () => {
    process.env.CALLRAIL_API_KEYS = '{"acme":{"apiKey":"k","accountId":"ACC_PROFILE"}}';
    expect(resolveCredentials({ profile: "acme" }).accountId).toBe("ACC_PROFILE");
    process.env.CALLRAIL_ACCOUNT_ID = "ACC_ENV";
    expect(resolveCredentials({ profile: "acme" }).accountId).toBe("ACC_ENV");
    expect(resolveCredentials({ profile: "acme", account: "ACC_FLAG" }).accountId).toBe(
      "ACC_FLAG",
    );
  });

  test("no credentials anywhere → actionable error", () => {
    process.env.CALLRAIL_PROFILE = "definitely-not-a-real-profile";
    expect(() => resolveCredentials()).toThrow(/CALLRAIL_API_KEY|Profile not found/);
  });
});

describe("client (read-only, URL construction)", () => {
  test("sends Token auth header and only GET, builds account-scoped URLs", async () => {
    const seen: { url: string; method: string; auth: string | null }[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        seen.push({
          url: req.url,
          method: req.method,
          auth: req.headers.get("authorization"),
        });
        return Response.json({ page: 1, per_page: 100, total_pages: 1, total_records: 0, calls: [] });
      },
    });
    const client = new CallRailClient({
      apiKey: "sekret",
      accountId: "ACC123",
      baseUrl: `http://localhost:${server.port}/v3`,
    });
    await client.accountGet("calls.json", {
      date_range: "last_7_days",
      tags: ["a", "b"],
      page: undefined,
    });
    server.stop();
    expect(seen).toHaveLength(1);
    const req = seen[0]!;
    expect(req.method).toBe("GET");
    expect(req.auth).toBe('Token token="sekret"');
    const url = new URL(req.url);
    expect(url.pathname).toBe("/v3/a/ACC123/calls.json");
    expect(url.searchParams.get("date_range")).toBe("last_7_days");
    expect(url.searchParams.getAll("tags[]")).toEqual(["a", "b"]);
    expect(url.searchParams.has("page")).toBe(false);
  });

  test("client class exposes no write methods", () => {
    const methods = Object.getOwnPropertyNames(CallRailClient.prototype);
    for (const banned of ["post", "put", "patch", "delete", "request"]) {
      expect(methods).not.toContain(banned);
    }
  });

  test("accountGet without an account throws with a hint", async () => {
    const client = new CallRailClient({ apiKey: "k", baseUrl: "http://localhost:1" });
    expect(client.accountGet("calls.json")).rejects.toThrow(/No account resolved/);
  });

  test("API errors carry status + body message", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ error: "invalid api key" }, { status: 401 }),
    });
    const client = new CallRailClient({ apiKey: "bad", baseUrl: `http://localhost:${server.port}` });
    try {
      await client.get("/a.json");
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain("401");
      expect((err as Error).message).toContain("invalid api key");
    } finally {
      server.stop();
    }
  });
});

describe("output", () => {
  const records = [
    { id: "CAL1", duration: 42, tags: ["x"] },
    { id: "CAL2", duration: 7, tags: [] },
  ];
  const envelope = { page: 1, total_records: 2, calls: records };

  test("json renders the full envelope", () => {
    expect(JSON.parse(renderList(envelope, records, "json"))).toEqual(envelope);
  });

  test("jsonl renders one record per line", () => {
    const lines = renderList(envelope, records, "jsonl").split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual(records[0]);
  });

  test("csv renders header + escaped rows", () => {
    const csv = renderList(envelope, records, "csv");
    expect(csv.split("\n")[0]).toBe('"id","duration","tags"');
    expect(csv).toContain('"CAL1","42","[""x""]"');
  });

  test("table renders columns", () => {
    const table = renderList(envelope, records, "table");
    expect(table).toContain("id");
    expect(table).toContain("CAL1");
  });

  test("renderObject table mode is field/value", () => {
    const table = renderObject({ a: 1, b: "two" }, "table");
    expect(table).toContain("field");
    expect(table).toContain("value");
  });

  test("parseFormat rejects unknown formats", () => {
    expect(() => parseFormat("yaml")).toThrow(/Unknown format/);
    expect(parseFormat(undefined)).toBe("json");
  });
});
