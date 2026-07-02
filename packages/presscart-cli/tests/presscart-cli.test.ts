import { describe, expect, test } from "bun:test";
import { uploadOwnArticle } from "../src/commands/articles.ts";
import { createAttachment } from "../src/commands/attachments.ts";
import { uploadContent } from "../src/commands/campaigns.ts";
import { buildProgram } from "../src/cli.ts";
import { filterByPrice, listMeta, rowPriceUsd } from "../src/output.ts";

function subOptions(parent: string, sub: string): string[] {
  const program = buildProgram();
  const p = program.commands.find((c: { name: () => string }) => c.name() === parent) as {
    commands: readonly { name: () => string; options: readonly { long?: string }[] }[];
  };
  const s = p.commands.find((c) => c.name() === sub);
  return (s?.options ?? []).map((o) => o.long ?? "").filter(Boolean);
}

function subnames(parent: string): string[] {
  const program = buildProgram();
  const p = program.commands.find((c: { name: () => string }) => c.name() === parent) as {
    commands: readonly { name: () => string }[];
  };
  return (p?.commands ?? []).map((c) => c.name());
}

describe("@mirage-cli/presscart-cli", () => {
  test("buildProgram() returns a configured Commander program", () => {
    const program = buildProgram();
    expect(program.name()).toBe("presscart");
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
    const names = program.commands.map((c: { name: () => string }) => c.name());
    expect(names).toContain("login");
    expect(names).toContain("whoami");
    expect(names).toContain("campaigns");
    expect(names).toContain("orders");
    expect(names).toContain("outlets");
    expect(names).toContain("profiles");
    expect(names).toContain("products");
  });

  test("campaigns subcommands are registered", () => {
    const program = buildProgram();
    const camp = program.commands.find(
      (c: { name: () => string }) => c.name() === "campaigns",
    );
    expect(camp).toBeDefined();
    const subnames = (camp as { commands: readonly { name: () => string }[] }).commands.map((c) =>
      c.name(),
    );
    expect(subnames).toContain("list");
    expect(subnames).toContain("create");
    expect(subnames).toContain("assign-items");
    expect(subnames).toContain("status-count");
  });

  test("orders has checkout subcommand", () => {
    const program = buildProgram();
    const ord = program.commands.find((c: { name: () => string }) => c.name() === "orders");
    const sub = (ord as { commands: readonly { name: () => string }[] }).commands.map((c) => c.name());
    expect(sub).toContain("checkout");
    expect(sub).toContain("items");
  });

  test("marketplace listing commands expose budget flags", () => {
    expect(subOptions("outlets", "list")).toEqual(
      expect.arrayContaining(["--min-price", "--max-price", "--all"]),
    );
    expect(subOptions("products", "listings")).toEqual(
      expect.arrayContaining(["--min-price", "--max-price"]),
    );
  });
});

describe("product listing price helpers", () => {
  const appleNews = { name: "Apple News", prices: [{ unit_amount: 775 }] };
  const cheap = { name: "Blog", prices: [{ unit_amount: 175 }, { unit_amount: 225 }] };
  const noPrice = { name: "Mystery", prices: [] };

  test("rowPriceUsd returns the lowest unit_amount as whole dollars", () => {
    expect(rowPriceUsd(appleNews)).toBe(775);
    expect(rowPriceUsd(cheap)).toBe(175);
    expect(rowPriceUsd(noPrice)).toBeUndefined();
    expect(rowPriceUsd({})).toBeUndefined();
  });

  test("filterByPrice respects min/max bounds and excludes priceless rows when bounded", () => {
    const rows = [appleNews, cheap, noPrice];
    expect(filterByPrice(rows, {})).toHaveLength(3);
    expect(filterByPrice(rows, { maxPrice: 500 })).toEqual([cheap]);
    expect(filterByPrice(rows, { minPrice: 500 })).toEqual([appleNews]);
    expect(filterByPrice(rows, { minPrice: 200, maxPrice: 800 })).toEqual([appleNews]);
  });

  test("listMeta pulls pagination metadata when present", () => {
    expect(listMeta({ records: [], total_records: 1466, total_pages: 59, page: 1 })).toEqual({
      totalRecords: 1466,
      totalPages: 59,
      page: 1,
    });
    expect(listMeta([])).toEqual({});
  });
});

describe("publishing commands (team-scoped)", () => {
  test("new top-level groups are registered", () => {
    const program = buildProgram();
    const names = program.commands.map((c: { name: () => string }) => c.name());
    expect(names).toEqual(expect.arrayContaining(["teams", "articles", "files", "attachments"]));
  });

  test("teams supports documented team-id lookup", () => {
    expect(subnames("teams")).toEqual(expect.arrayContaining(["list", "get"]));
  });

  test("articles subcommands + options", () => {
    expect(subnames("articles")).toEqual(
      expect.arrayContaining(["get", "upload-own-article", "submit"]),
    );
    expect(subOptions("articles", "upload-own-article")).toEqual(
      expect.arrayContaining(["--source", "--google-doc-url", "--file-id"]),
    );
    expect(subOptions("articles", "submit")).toEqual(
      expect.arrayContaining(["--action", "--feedback"]),
    );
  });

  test("files upload + attachments create options", () => {
    expect(subnames("files")).toContain("upload");
    expect(subOptions("files", "upload")).toEqual(
      expect.arrayContaining(["--file", "--folder-id"]),
    );
    expect(subOptions("attachments", "create")).toEqual(
      expect.arrayContaining(["--file-ids", "--resource-type", "--resource-id"]),
    );
  });

  test("campaigns upload-content registered with order/profile options", () => {
    expect(subnames("campaigns")).toContain("upload-content");
    expect(subOptions("campaigns", "upload-content")).toEqual(
      expect.arrayContaining([
        "--order-id",
        "--profile-id",
        "--campaign-id",
        "--campaign-name",
      ]),
    );
  });
});

describe("publishing input guards (reject before hitting the API)", () => {
  const opts = { format: "json" };

  test("upload-own-article requires the field matching --source", async () => {
    await expect(uploadOwnArticle("slug", "aid", { source: "google_doc" }, opts)).rejects.toThrow(
      /google-doc-url is required/,
    );
    await expect(
      uploadOwnArticle("slug", "aid", { source: "file_attachment" }, opts),
    ).rejects.toThrow(/file-id is required/);
  });

  test("campaigns upload-content requires a campaign id or name", async () => {
    await expect(
      uploadContent("slug", { order_id: "o", profile_id: "p" }, opts),
    ).rejects.toThrow(/campaign is required/);
  });

  test("attachments create rejects empty or oversized file-id lists", async () => {
    await expect(createAttachment([], "article_photo", "aid", opts)).rejects.toThrow(
      /between 1 and 50/,
    );
    const tooMany = Array.from({ length: 51 }, (_, i) => `id-${i}`);
    await expect(createAttachment(tooMany, "article_photo", "aid", opts)).rejects.toThrow(
      /between 1 and 50/,
    );
  });
});
