import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { HubSpotClient } from "../src/client.ts";
import {
  accountTokenProvider,
  loadEnvAccounts,
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
  "HUBSPOT_ACCOUNTS",
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

describe("HUBSPOT_ACCOUNTS", () => {
  const accounts = JSON.stringify({ viewengine: "pat-ve", acme: "pat-acme" });

  test("--account selects the named token", async () => {
    process.env.HUBSPOT_ACCOUNTS = accounts;
    const resolved = await resolveAuth({ account: "acme" });
    expect(resolved.source).toBe("env-accounts");
    expect(resolved.account).toBe("acme");
    expect(await resolved.tokenProvider()).toBe("pat-acme");
  });

  test("a single entry is used without --account", async () => {
    process.env.HUBSPOT_ACCOUNTS = JSON.stringify({ viewengine: "pat-ve" });
    expect(await (await resolveAuth()).tokenProvider()).toBe("pat-ve");
  });

  test("several entries without --account list the names, never the tokens", async () => {
    process.env.HUBSPOT_ACCOUNTS = accounts;
    const err = await resolveAuth().catch((e: Error) => e);
    expect(String(err)).toContain("viewengine, acme");
    expect(String(err)).not.toContain("pat-");
  });

  test("an unknown account names the valid ones", async () => {
    process.env.HUBSPOT_ACCOUNTS = accounts;
    await expect(resolveAuth({ account: "nope" })).rejects.toThrow(/Unknown HubSpot account "nope".*viewengine, acme/);
  });

  test("malformed JSON fails without echoing the value", async () => {
    process.env.HUBSPOT_ACCOUNTS = "{pat-secret";
    const err = await resolveAuth().catch((e: Error) => e);
    expect(String(err)).toContain("not valid JSON");
    expect(String(err)).not.toContain("pat-secret");
  });

  test("non-string tokens are rejected", () => {
    process.env.HUBSPOT_ACCOUNTS = JSON.stringify({ acme: 1 });
    expect(() => loadEnvAccounts()).toThrow(/"acme" must be a non-empty access token/);
  });

  test("precedes HUBSPOT_ACCESS_TOKEN, and --token precedes both", async () => {
    process.env.HUBSPOT_ACCOUNTS = accounts;
    process.env.HUBSPOT_ACCESS_TOKEN = "pat-env";
    expect((await resolveAuth({ account: "acme" })).source).toBe("env-accounts");
    expect((await resolveAuth({ token: "pat-flag", account: "acme" })).source).toBe("flag-token");
  });
});

describe("HUBSPOT_ACCOUNTS personal access keys", () => {
  const realFetch = globalThis.fetch;
  let calls: string[] = [];
  function mockExchange(status: number) {
    calls = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return status === 200
        ? new Response(JSON.stringify({ oauthAccessToken: "exchanged", expiresAtMillis: Date.now() + 3_600_000 }), { status })
        : new Response(JSON.stringify({ message: "nope" }), { status });
    }) as typeof fetch;
  }
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("a pat- key is used directly, with no exchange", async () => {
    mockExchange(200);
    expect(await accountTokenProvider("pat-na1-x", "https://api.example")).toBe("pat-na1-x");
    expect(calls).toHaveLength(0);
  });

  test("any other value is exchanged as a personal access key", async () => {
    mockExchange(200);
    expect(await accountTokenProvider("pak-value-1", "https://api.example")).toBe("exchanged");
    expect(calls[0]).toBe("https://api.example/localdevauth/v1/auth/refresh");
  });

  test("a value the exchange refuses is used directly, and not exchanged again", async () => {
    mockExchange(401);
    expect(await accountTokenProvider("oauth-token-2", "https://api.example")).toBe("oauth-token-2");
    expect(await accountTokenProvider("oauth-token-2", "https://api.example")).toBe("oauth-token-2");
    expect(calls).toHaveLength(1);
  });

  test("a server error during the exchange is surfaced, not masked", async () => {
    mockExchange(503);
    await expect(accountTokenProvider("pak-value-3", "https://api.example")).rejects.toThrow(/exchange failed/);
  });

  test("resolveAuth routes account values through the same provider", async () => {
    mockExchange(200);
    process.env.HUBSPOT_ACCOUNTS = JSON.stringify({ acme: "pak-value-4" });
    process.env.HUBSPOT_API_BASE_URL = "https://api.example";
    expect(await (await resolveAuth()).tokenProvider()).toBe("exchanged");
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
