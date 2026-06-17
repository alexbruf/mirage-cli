import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AirtableClient } from "../src/client.ts";
import { resolveBase, resolveToken } from "../src/config.ts";
import { buildProgram } from "../src/cli.ts";
import { parseFormat, renderList, renderObject } from "../src/output.ts";

const ENV_KEYS = [
  "AIRTABLE_API_KEY",
  "AIRTABLE_TOKEN",
  "AIRTABLE_BASE_ID",
  "AIRTABLE_API_BASE_URL",
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
  test("buildProgram() returns a Commander program named airtable", () => {
    const program = buildProgram();
    expect(program.name()).toBe("airtable");
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("exposes the canonical MCP read-tool command names (no write tools)", () => {
    const names = buildProgram().commands.map((c) => c.name());
    expect(names).toEqual(
      expect.arrayContaining([
        "list-bases",
        "list-tables",
        "describe-table",
        "list-records",
        "search-records",
        "get-record",
        "whoami",
        "api",
      ]),
    );
    // The 7 write tools must not be reachable.
    for (const w of ["create-record", "update-records", "delete-records", "create-table"]) {
      expect(names).not.toContain(w);
    }
  });

  test("list-tables aliases schema, list-records aliases records", () => {
    const cmds = buildProgram().commands;
    expect(cmds.find((c) => c.name() === "list-tables")!.aliases()).toContain("schema");
    expect(cmds.find((c) => c.name() === "list-records")!.aliases()).toContain("records");
  });

  test("list-records carries the official flag vocabulary", () => {
    const lr = buildProgram().commands.find((c) => c.name() === "list-records")!;
    const flags = lr.options.map((o) => o.long);
    expect(flags).toEqual(
      expect.arrayContaining([
        "--baseId",
        "--tableIdOrName",
        "--fields",
        "--view",
        "--filterByFormula",
        "--sort",
        "--maxRecords",
        "--all",
      ]),
    );
  });
});

describe("credential resolution", () => {
  test("--token wins", () => {
    expect(resolveToken({ token: "patFlag" })).toEqual({ token: "patFlag", source: "flag" });
  });
  test("AIRTABLE_API_KEY then AIRTABLE_TOKEN", () => {
    process.env.AIRTABLE_TOKEN = "patAlias";
    expect(resolveToken().token).toBe("patAlias");
    process.env.AIRTABLE_API_KEY = "patPrimary";
    expect(resolveToken().token).toBe("patPrimary");
  });
  test("missing token throws actionably", () => {
    expect(() => resolveToken()).toThrow(/No Airtable token/);
  });
});

describe("base resolution", () => {
  test("explicit arg > --base > env", () => {
    process.env.AIRTABLE_BASE_ID = "appEnv";
    expect(resolveBase({ base: "appFlag" }, "appArg")).toBe("appArg");
    expect(resolveBase({ base: "appFlag" })).toBe("appFlag");
    expect(resolveBase({})).toBe("appEnv");
  });
  test("missing base throws actionably", () => {
    expect(() => resolveBase({})).toThrow(/No Airtable base/);
  });
});

describe("output", () => {
  test("parseFormat rejects unknown formats", () => {
    expect(() => parseFormat("yaml")).toThrow(/Unknown format/);
  });

  test("table/csv lift record `fields` up to top-level columns", () => {
    const rec = { id: "rec1", createdTime: "t", fields: { Name: "Acme", Status: "Done" } };
    const table = renderList({ records: [rec] }, [rec], "table");
    expect(table).toContain("Name");
    expect(table).toContain("Acme");
    expect(table).toContain("Status");
  });

  test("json passes the envelope through verbatim", () => {
    const env = { records: [{ id: "r1" }], offset: "off" };
    expect(JSON.parse(renderList(env, env.records, "json"))).toEqual(env);
  });

  test("renderObject json round-trips", () => {
    expect(JSON.parse(renderObject({ a: 1 }, "json"))).toEqual({ a: 1 });
  });
});

describe("read-only client", () => {
  test("AirtableClient exposes only get() (no mutating verbs)", () => {
    const client = new AirtableClient({ token: "x" });
    expect(typeof client.get).toBe("function");
    for (const verb of ["post", "patch", "put", "delete", "search"]) {
      expect((client as unknown as Record<string, unknown>)[verb]).toBeUndefined();
    }
  });
});
