import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildProgram } from "../src/cli.ts";
import {
  fingerprint,
  normalizeNodeIds,
  parseAuthScheme,
  parseFileKey,
  resolveFileKey,
  resolveTeamId,
  resolveToken,
} from "../src/config.ts";
import { mapToRows, parseFormat, renderList, renderObject } from "../src/output.ts";

const ENV_KEYS = [
  "FIGMA_TOKEN",
  "FIGMA_API_KEY",
  "FIGMA_PERSONAL_ACCESS_TOKEN",
  "FIGMA_OAUTH_ACCESS_TOKEN",
  "FIGMA_FILE_KEY",
  "FIGMA_TEAM_ID",
  "FIGMA_API_BASE_URL",
] as const;

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function subcommands(name?: string): string[] {
  const program = buildProgram();
  const target = name ? program.commands.find((c) => c.name() === name) : program;
  if (!target) throw new Error(`no such command group: ${name}`);
  return target.commands.map((c) => c.name()).sort();
}

describe("program shape", () => {
  test("is a pure factory — a fresh program every call", () => {
    const a = buildProgram();
    const b = buildProgram();
    expect(a).not.toBe(b);
    expect(a.name()).toBe("figma");
    expect(a.version()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("exposes the expected top-level commands", () => {
    expect(subcommands()).toEqual(
      expect.arrayContaining([
        "api",
        "comments",
        "component-sets",
        "components",
        "dev-resources",
        "export",
        "files",
        "folders",
        "image-fills",
        "projects",
        "styles",
        "teams",
        "variables",
        "whoami",
      ]),
    );
  });

  test("global flags cover both credential kinds and the output format", () => {
    const longs = buildProgram()
      .options.map((o) => o.long)
      .filter((l): l is string => typeof l === "string");
    expect(longs).toEqual(
      expect.arrayContaining([
        "--token",
        "--auth-scheme",
        "--file-key",
        "--team-id",
        "--base-url",
        "--format",
      ]),
    );
  });

  test("every mutating verb sits under a prefix a host can gate on", () => {
    // ve-brain gates writes with regexes anchored on these exact strings; if a
    // write verb moves out from under one of these groups it silently becomes
    // available on read-only mounts.
    expect(subcommands("comments")).toEqual(
      expect.arrayContaining(["delete", "post", "react", "reactions", "unreact"]),
    );
    expect(subcommands("variables")).toEqual(["local", "post", "published"]);
    expect(subcommands("dev-resources")).toEqual(
      expect.arrayContaining(["create", "delete", "list", "update"]),
    );
  });

  test("read-only groups expose no write verbs", () => {
    expect(subcommands("files")).toEqual(["get", "meta", "nodes", "versions"]);
    expect(subcommands("components")).toEqual(["file", "get", "team"]);
    expect(subcommands("teams")).toEqual(["projects"]);
  });
});

describe("credential resolution", () => {
  test("throws an actionable error when nothing is set", () => {
    expect(() => resolveToken()).toThrow(/No Figma credential/);
  });

  test("a personal access token travels in X-Figma-Token", () => {
    process.env.FIGMA_TOKEN = "figd_abc123";
    expect(resolveToken()).toEqual({
      token: "figd_abc123",
      scheme: "x-figma-token",
      source: "pat-env",
    });
  });

  test("an OAuth token travels as a bearer and outranks a personal access token", () => {
    process.env.FIGMA_TOKEN = "figd_abc123";
    process.env.FIGMA_OAUTH_ACCESS_TOKEN = "figu_xyz789";
    expect(resolveToken()).toEqual({
      token: "figu_xyz789",
      scheme: "bearer",
      source: "oauth-env",
    });
  });

  test("--token outranks both, and its scheme is inferred from the prefix", () => {
    process.env.FIGMA_OAUTH_ACCESS_TOKEN = "figu_xyz789";
    expect(resolveToken({ token: "figd_flag" })).toEqual({
      token: "figd_flag",
      scheme: "x-figma-token",
      source: "flag",
    });
    expect(resolveToken({ token: "figu_flag" }).scheme).toBe("bearer");
  });

  test("--auth-scheme overrides the inference in both directions", () => {
    expect(resolveToken({ token: "figd_abc", authScheme: "bearer" }).scheme).toBe("bearer");
    process.env.FIGMA_OAUTH_ACCESS_TOKEN = "figu_xyz";
    expect(resolveToken({ authScheme: "x-figma-token" }).scheme).toBe("x-figma-token");
  });

  test("env aliases are honoured in order", () => {
    process.env.FIGMA_API_KEY = "from-api-key";
    expect(resolveToken().token).toBe("from-api-key");
    process.env.FIGMA_TOKEN = "from-token";
    expect(resolveToken().token).toBe("from-token");
  });

  test("an unknown auth scheme is rejected", () => {
    expect(() => parseAuthScheme("basic")).toThrow(/Unknown auth scheme/);
    expect(parseAuthScheme(undefined)).toBeUndefined();
  });

  test("fingerprint never reveals more than the last four characters", () => {
    expect(fingerprint("figd_supersecretvalue")).toBe("…alue");
    expect(fingerprint("ab")).toBe("…");
  });
});

describe("file keys, team ids, node ids", () => {
  test("accepts a raw key unchanged", () => {
    expect(parseFileKey("aBc123XyZ")).toBe("aBc123XyZ");
  });

  test("reads a key out of every Figma URL shape", () => {
    expect(parseFileKey("https://www.figma.com/design/aBc123/My-File?node-id=1-23")).toBe("aBc123");
    expect(parseFileKey("https://www.figma.com/file/aBc123/Legacy")).toBe("aBc123");
    expect(parseFileKey("https://www.figma.com/board/aBc123/Jam")).toBe("aBc123");
    expect(parseFileKey("https://www.figma.com/slides/aBc123/Deck")).toBe("aBc123");
  });

  test("rejects a figma.com URL it cannot read a key from", () => {
    expect(() => parseFileKey("https://www.figma.com/files/recents")).toThrow(/file key/);
  });

  test("falls back to FIGMA_FILE_KEY, and explains itself when unset", () => {
    process.env.FIGMA_FILE_KEY = "https://www.figma.com/design/envKey/Name";
    expect(resolveFileKey()).toBe("envKey");
    delete process.env.FIGMA_FILE_KEY;
    expect(() => resolveFileKey()).toThrow(/No Figma file/);
  });

  test("team ids come from an id, a team URL, or the env", () => {
    expect(resolveTeamId({}, "123456")).toBe("123456");
    expect(resolveTeamId({}, "https://www.figma.com/files/team/98765/Design")).toBe("98765");
    process.env.FIGMA_TEAM_ID = "55555";
    expect(resolveTeamId()).toBe("55555");
    delete process.env.FIGMA_TEAM_ID;
    expect(() => resolveTeamId()).toThrow(/No Figma team/);
  });

  test("node ids normalise the URL spelling to the API spelling", () => {
    expect(normalizeNodeIds("1-23,4:56, 7-8 ")).toEqual(["1:23", "4:56", "7:8"]);
    expect(normalizeNodeIds(" , ")).toEqual([]);
  });
});

describe("output rendering", () => {
  test("rejects an unknown format and defaults to json", () => {
    expect(parseFormat(undefined)).toBe("json");
    expect(() => parseFormat("yaml")).toThrow(/Unknown format/);
  });

  test("json renders the whole envelope, jsonl only the records", () => {
    const envelope = { comments: [{ id: "1" }, { id: "2" }], cursor: "abc" };
    expect(JSON.parse(renderList(envelope, envelope.comments, "json"))).toEqual(envelope);
    expect(renderList(envelope, envelope.comments, "jsonl")).toBe('{"id":"1"}\n{"id":"2"}');
  });

  test("table and csv flatten a record list", () => {
    const rows = [{ id: "1", name: "Hero" }];
    expect(renderList({ rows }, rows, "table")).toContain("Hero");
    expect(renderList({ rows }, rows, "csv")).toBe('"id","name"\n"1","Hero"');
    expect(renderList({ rows: [] }, [], "table")).toBe("(no rows)");
  });

  test("renderObject turns a detail response into field/value rows", () => {
    expect(renderObject({ id: "1", name: "Hero" }, "table")).toContain("field");
    expect(renderObject({ id: "1" }, "jsonl")).toBe('{"id":"1"}');
  });

  test("mapToRows turns an id-keyed map into rows, keeping the key", () => {
    expect(mapToRows({ "1:23": { name: "Hero" } })).toEqual([{ id: "1:23", name: "Hero" }]);
    expect(mapToRows({ "1:23": "https://example.test/a.png" })).toEqual([
      { id: "1:23", value: "https://example.test/a.png" },
    ]);
    expect(mapToRows(undefined)).toEqual([]);
  });
});
