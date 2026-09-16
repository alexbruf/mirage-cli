import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { HubSpotClient } from "../src/client.ts";
import {
  exchangePersonalAccessKey,
  resolveAuth,
  selectHsAccount,
  type HsConfig,
} from "../src/config.ts";
import { buildProgram } from "../src/cli.ts";
import { parseFormat, renderList, renderObject } from "../src/output.ts";

function subnames(program: ReturnType<typeof buildProgram>, name: string): string[] {
  const cmd = program.commands.find((c: { name: () => string }) => c.name() === name);
  return (cmd as { commands: readonly { name: () => string }[] }).commands.map((c) => c.name());
}

const ENV_KEYS = [
  "HUBSPOT_ACCESS_TOKEN",
  "HUBSPOT_PERSONAL_ACCESS_KEY",
  "HUBSPOT_ACCOUNT_ID",
  "HUBSPOT_API_BASE_URL",
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
  test("buildProgram() returns a Commander program named hubspot", () => {
    const program = buildProgram();
    expect(program.name()).toBe("hubspot");
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("top-level groups", () => {
    const names = buildProgram().commands.map((c) => c.name());
    expect(names).toEqual(expect.arrayContaining(["crm", "marketing", "cms", "account", "api"]));
  });

  test("crm exposes the standard objects + generic object + metadata", () => {
    const names = subnames(buildProgram(), "crm");
    expect(names).toEqual(
      expect.arrayContaining([
        "contacts",
        "companies",
        "deals",
        "tickets",
        "object",
        "properties",
        "owners",
        "pipelines",
        "associations",
      ]),
    );
  });

  test("each standard object has list/get/search", () => {
    const crm = buildProgram().commands.find((c) => c.name() === "crm")!;
    const contacts = crm.commands.find((c) => c.name() === "contacts")!;
    expect(contacts.commands.map((c) => c.name())).toEqual(
      expect.arrayContaining(["list", "get", "search"]),
    );
  });
});

describe("credential resolution", () => {
  test("--token flag wins and is used as a direct bearer", async () => {
    const resolved = await resolveAuth({ token: "pat-flag" });
    expect(resolved.source).toBe("flag-token");
    expect(await resolved.tokenProvider()).toBe("pat-flag");
  });

  test("HUBSPOT_ACCESS_TOKEN is used directly without exchange", async () => {
    process.env.HUBSPOT_ACCESS_TOKEN = "pat-env";
    const resolved = await resolveAuth();
    expect(resolved.source).toBe("env-token");
    expect(await resolved.tokenProvider()).toBe("pat-env");
  });

  test("env personal access key resolves to the PAK exchange path", async () => {
    process.env.HUBSPOT_PERSONAL_ACCESS_KEY = "pak-env";
    const resolved = await resolveAuth();
    expect(resolved.source).toBe("env-pak");
  });

  test("direct token precedes an env personal access key", async () => {
    process.env.HUBSPOT_ACCESS_TOKEN = "pat-env";
    process.env.HUBSPOT_PERSONAL_ACCESS_KEY = "pak-env";
    expect((await resolveAuth()).source).toBe("env-token");
  });
});

describe("selectHsAccount", () => {
  const config: HsConfig = {
    defaultAccount: "prod",
    accounts: [
      { name: "prod", accountId: 111, personalAccessKey: "pak-prod" },
      { name: "sandbox", accountId: 222, personalAccessKey: "pak-sbx" },
    ],
  };

  test("selects by name", () => {
    expect(selectHsAccount(config, "sandbox")?.accountId).toBe(222);
  });
  test("selects by numeric id", () => {
    expect(selectHsAccount(config, "111")?.name).toBe("prod");
  });
  test("falls back to the configured default", () => {
    expect(selectHsAccount(config)?.name).toBe("prod");
  });
  test("returns null on miss", () => {
    expect(selectHsAccount(config, "nope")).toBeNull();
  });
});

describe("read-only client", () => {
  test("search() refuses a non-/search path (no write primitive)", async () => {
    const client = new HubSpotClient({ token: "x" });
    await expect(client.search("/crm/v3/objects/contacts", {})).rejects.toThrow(/Refusing/);
  });
});

describe("credential origin", () => {
  const realFetch = globalThis.fetch;
  const savedBase = process.env.HUBSPOT_API_BASE_URL;
  let calls: { url: string; init?: RequestInit }[] = [];

  beforeEach(() => {
    calls = [];
    delete process.env.HUBSPOT_API_BASE_URL;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (savedBase === undefined) delete process.env.HUBSPOT_API_BASE_URL;
    else process.env.HUBSPOT_API_BASE_URL = savedBase;
  });

  test("sends the token to api.hubapi.com and refuses redirects", async () => {
    await new HubSpotClient({ token: "t" }).get("/crm/v3/objects/contacts", { limit: 1 });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]?.url ?? "").origin).toBe("https://api.hubapi.com");
    expect(calls[0]?.init?.redirect).toBe("error");
  });

  test("accepts a regional HubSpot API host", async () => {
    await new HubSpotClient({ token: "t", baseUrl: "https://api-eu1.hubapi.com/" }).get("/x");
    expect(new URL(calls[0]?.url ?? "").origin).toBe("https://api-eu1.hubapi.com");
  });

  test("refuses any other origin from the flag or the environment", () => {
    for (const baseUrl of [
      "https://attacker.example",
      "http://api.hubapi.com",
      "https://api.hubapi.com.attacker.example",
      "https://user@api.hubapi.com",
      "https://api.hubapi.com/proxy",
      "not a url",
    ]) {
      expect(() => new HubSpotClient({ token: "t", baseUrl })).toThrow(/credential origin/);
    }
    process.env.HUBSPOT_API_BASE_URL = "https://attacker.example";
    expect(() => new HubSpotClient({ token: "t" })).toThrow(/credential origin/);
    expect(calls).toHaveLength(0);
  });

  test("refuses to send a personal access key to another origin", async () => {
    await expect(
      exchangePersonalAccessKey("pak", undefined, "https://attacker.example"),
    ).rejects.toThrow(/credential origin/);
    expect(calls).toHaveLength(0);
  });

  test("the CLI fails before any request when --base-url points elsewhere", async () => {
    const program = buildProgram();
    program.exitOverride();
    const errors: string[] = [];
    const realError = console.error;
    const realExit = process.exit;
    console.error = (...args: unknown[]) => errors.push(args.join(" "));
    process.exit = ((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as typeof process.exit;
    try {
      await program
        .parseAsync(
          ["--token", "t", "--base-url", "https://attacker.example", "crm", "contacts", "list"],
          { from: "user" },
        )
        .catch(() => undefined);
    } finally {
      console.error = realError;
      process.exit = realExit;
    }
    expect(calls).toHaveLength(0);
  });
});

describe("output", () => {
  test("parseFormat rejects unknown formats", () => {
    expect(() => parseFormat("xml")).toThrow(/Unknown format/);
  });

  test("table/csv lift CRM `properties` up to top-level columns", () => {
    const record = { id: "1", properties: { email: "a@b.co", firstname: "Ada" } };
    const table = renderList({ results: [record] }, [record], "table");
    expect(table).toContain("email");
    expect(table).toContain("a@b.co");
    expect(table).toContain("firstname");
  });

  test("json passes the envelope through verbatim", () => {
    const env = { results: [{ id: "1" }], paging: { next: { after: "c" } } };
    expect(JSON.parse(renderList(env, env.results, "json"))).toEqual(env);
  });

  test("renderObject json round-trips", () => {
    expect(JSON.parse(renderObject({ a: 1 }, "json"))).toEqual({ a: 1 });
  });
});
