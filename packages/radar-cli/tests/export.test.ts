import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import type { ApiClient } from "../src/client.ts";
import { registerExportCommands } from "../src/commands/export.ts";

/** Run `export-results` with a stub client and return the query it sent. */
async function queryFor(argv: string[]) {
  let sent: { path?: string; query?: Record<string, unknown> } = {};
  const client = {
    requestRaw: async (path: string, opts: { query?: Record<string, unknown> }) => {
      sent = { path, query: opts.query };
      return new Response("");
    },
  } as unknown as ApiClient;
  const program = new Command().exitOverride();
  registerExportCommands(program, async () => client);
  await program.parseAsync(["node", "radar", "export-results", "--project", "p-1", ...argv]);
  const query = Object.fromEntries(
    Object.entries(sent.query ?? {}).filter(([, v]) => v !== undefined),
  );
  return { path: sent.path, query };
}

describe("export-results", () => {
  test("sends only the project by default (full text, all fields)", async () => {
    expect(await queryFor([])).toEqual({ path: "/v1/export-full", query: { projectId: "p-1" } });
  });

  test("maps --until, --fields and --no-text", async () => {
    const { query } = await queryFor([
      "--until",
      "2026-09-30",
      "--fields",
      "provider,brands",
      "--no-text",
    ]);
    expect(query).toEqual({
      projectId: "p-1",
      until: "2026-09-30",
      fields: "provider,brands",
      text: "0",
    });
  });
});
