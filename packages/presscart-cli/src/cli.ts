import { Command } from "commander";
import * as auth from "./auth.ts";
import * as campaigns from "./commands/campaigns.ts";
import * as orders from "./commands/orders.ts";
import * as outlets from "./commands/outlets.ts";
import * as profiles from "./commands/profiles.ts";
import * as products from "./commands/products.ts";

type FmtOpts = { format?: string; output?: string };

function fmt<T extends Command>(cmd: T): T {
  return cmd
    .option("-f, --format <fmt>", "Output format: ascii|json|csv|markdown", "ascii")
    .option("-o, --output <file>", "Write output to file") as T;
}

/**
 * Build the Presscart Commander program. Pure function — no side effects, safe
 * to call from in-process wrappers (`@mirage-cli/presscart`) or the CLI entry
 * point below.
 */
export function buildProgram(): Command {
  const program = new Command();
  program
    .name("presscart")
    .description("Presscart CLI — drives the api.presscart.com REST API")
    .version("0.1.0");

  // ── Auth ────────────────────────────────────────────────────────────────
  program
    .command("login")
    .description("Save a Presscart API token (Bearer pc_...) and verify it")
    .requiredOption("--token <pc_...>", "Presscart API token")
    .option("--base-url <url>", "Override API base URL (default https://api.presscart.com)")
    .action(async (opts: { token: string; baseUrl?: string }) => {
      await auth.loginWithToken(opts.token, opts.baseUrl);
    });

  program
    .command("whoami")
    .description("Show current token info (GET /auth/token)")
    .action(async () => {
      await auth.whoami();
    });

  program
    .command("logout")
    .description("Clear saved session")
    .action(() => {
      auth.logout();
    });

  // ── Campaigns ───────────────────────────────────────────────────────────
  const camp = program.command("campaigns").description("Manage campaigns");

  fmt(camp.command("list"))
    .description("List campaigns for your team (GET /campaigns)")
    .option("--limit <n>", "Page size", (v: string) => Number.parseInt(v, 10))
    .option("--page <n>", "Page number", (v: string) => Number.parseInt(v, 10))
    .option("--sort-by <field>", "Sort field")
    .option("--order-by <dir>", "asc|desc")
    .option("--search <q>", "Search by campaign name")
    .action(async (opts: campaigns.ListOpts) => campaigns.listCampaigns(opts));

  fmt(camp.command("get <id>"))
    .description("Get a campaign by ID (GET /campaigns/:id)")
    .action(async (id: string, opts: FmtOpts) => campaigns.getCampaign(id, opts));

  fmt(camp.command("create"))
    .description("Create a campaign from a JSON file (POST /campaigns)")
    .requiredOption("--file <path>", "JSON body file with campaign fields")
    .action(async (opts: { file: string } & FmtOpts) =>
      campaigns.createCampaignFromFile(opts.file, opts),
    );

  fmt(camp.command("update <id>"))
    .description("Update a campaign from a JSON file (PUT /campaigns/:id)")
    .requiredOption("--file <path>", "JSON body file with partial campaign fields")
    .action(async (id: string, opts: { file: string } & FmtOpts) => {
      const { readFileSync } = await import("node:fs");
      const body = JSON.parse(readFileSync(opts.file, "utf8"));
      await campaigns.updateCampaign(id, body, opts);
    });

  fmt(camp.command("articles <id>"))
    .description("List articles for a campaign (GET /campaigns/:id/articles)")
    .option("--limit <n>", "Page size", (v: string) => Number.parseInt(v, 10))
    .option("--page <n>", "Page number", (v: string) => Number.parseInt(v, 10))
    .option("--sort-by <field>", "Sort field")
    .option("--order-by <dir>", "asc|desc")
    .action(async (id: string, opts: campaigns.ListOpts) =>
      campaigns.listCampaignArticles(id, opts),
    );

  fmt(camp.command("status-count <id>"))
    .description(
      "Article counts grouped by status (GET /campaigns/:id/articles/status-count)",
    )
    .action(async (id: string, opts: FmtOpts) => campaigns.articleStatusCount(id, opts));

  fmt(camp.command("assign-items <id> <item-ids>"))
    .description(
      "Assign order items to a campaign (POST /campaigns/:id/order-items). " +
        "<item-ids> is a comma-separated list of order_item UUIDs.",
    )
    .action(async (id: string, itemIds: string, opts: FmtOpts) => {
      const ids = itemIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      await campaigns.assignOrderItems(id, ids, opts);
    });

  // ── Orders ──────────────────────────────────────────────────────────────
  const ord = program.command("orders").description("Orders & checkout");

  fmt(ord.command("list"))
    .description("List orders for your team (GET /orders)")
    .action(async (opts: FmtOpts) => orders.listOrders(opts));

  fmt(ord.command("get <id>"))
    .description("Get an order by ID (GET /orders/:id)")
    .action(async (id: string, opts: FmtOpts) => orders.getOrder(id, opts));

  fmt(ord.command("items"))
    .description("List order items for your team (GET /order-items)")
    .action(async (opts: FmtOpts) => orders.listOrderItems(opts));

  fmt(ord.command("checkout"))
    .description("Create an order from a JSON body file (POST /orders/checkout)")
    .requiredOption("--file <path>", "JSON body file with profile_id + line_items[]")
    .action(async (opts: { file: string } & FmtOpts) =>
      orders.checkoutFromFile(opts.file, opts),
    );

  // ── Outlets ─────────────────────────────────────────────────────────────
  const out = program.command("outlets").description("Outlets & marketplace");

  fmt(out.command("list"))
    .description(
      "List outlet *listings* from the marketplace (GET /outlets). " +
        "Each row has both `id` (listing SKU) and `outlet_id` — pass `outlet_id` " +
        "to `outlets get`.",
    )
    .option("--limit <n>", "Page size", (v: string) => Number.parseInt(v, 10))
    .option("--page <n>", "Page number", (v: string) => Number.parseInt(v, 10))
    .option("--search <q>", "Free-text search")
    .option("--country <c>", "Filter by country")
    .option("--state <s>", "Filter by state")
    .option("--city <c>", "Filter by city")
    .option("--tag <t>", "Filter by tag")
    .option("--all", "Follow pagination and return every page (capped at 100)")
    .option("--max-price <usd>", "Budget cap: only listings <= this price (whole USD)", (v: string) => Number.parseFloat(v))
    .option("--min-price <usd>", "Only listings >= this price (whole USD)", (v: string) => Number.parseFloat(v))
    .action(async (opts: outlets.ListOutletsOpts) => outlets.listOutlets(opts));

  fmt(out.command("get <id>"))
    .description("Get an outlet by ID (GET /outlets/:id)")
    .action(async (id: string, opts: FmtOpts) => outlets.getOutlet(id, opts));

  fmt(out.command("products <id>"))
    .description("List products for an outlet (GET /outlets/:id/products)")
    .action(async (id: string, opts: FmtOpts) => outlets.outletProducts(id, opts));

  fmt(out.command("countries"))
    .description("Distinct outlet countries (GET /outlets/locations/countries)")
    .action(async (opts: FmtOpts) => outlets.countries(opts));

  fmt(out.command("states"))
    .description("Distinct outlet states (GET /outlets/locations/states)")
    .option("--country <c>", "Filter by country")
    .action(async (opts: { country?: string } & FmtOpts) => outlets.states(opts.country, opts));

  fmt(out.command("cities"))
    .description("Distinct outlet cities (GET /outlets/locations/cities)")
    .option("--country <c>", "Filter by country")
    .option("--state <s>", "Filter by state")
    .action(async (opts: { country?: string; state?: string } & FmtOpts) =>
      outlets.cities(opts.country, opts.state, opts),
    );

  fmt(out.command("tags"))
    .description("List outlet tag names (GET /tags)")
    .action(async (opts: FmtOpts) => outlets.tags(opts));

  fmt(out.command("disclaimers"))
    .description("List outlet disclaimer types (GET /outlet-disclaimers)")
    .action(async (opts: FmtOpts) => outlets.disclaimers(opts));

  // ── Profiles ────────────────────────────────────────────────────────────
  const prof = program.command("profiles").description("Profiles (per-team)");

  fmt(prof.command("list <team-id>"))
    .description("List profiles for a team (GET /teams/:team_id/profiles)")
    .action(async (teamId: string, opts: FmtOpts) => profiles.listProfiles(teamId, opts));

  fmt(prof.command("create"))
    .description("Create a profile from a JSON body file (POST /profiles)")
    .requiredOption("--file <path>", "JSON body file")
    .action(async (opts: { file: string } & FmtOpts) =>
      profiles.createProfileFromFile(opts.file, opts),
    );

  fmt(prof.command("update <id>"))
    .description("Update a profile from a JSON body file (PATCH /profiles/:id)")
    .requiredOption("--file <path>", "JSON body file with partial profile fields")
    .action(async (id: string, opts: { file: string } & FmtOpts) => {
      const { readFileSync } = await import("node:fs");
      const body = JSON.parse(readFileSync(opts.file, "utf8"));
      await profiles.updateProfile(id, body, opts);
    });

  fmt(prof.command("orders <id>"))
    .description("List a profile's orders (GET /profiles/:id/orders)")
    .action(async (id: string, opts: FmtOpts) => profiles.profileOrders(id, opts));

  fmt(prof.command("order-items <id>"))
    .description("List a profile's order line items (GET /profiles/:id/order-items)")
    .action(async (id: string, opts: FmtOpts) => profiles.profileOrderItems(id, opts));

  fmt(prof.command("campaigns <id>"))
    .description("List a profile's campaigns (GET /profiles/:id/campaigns)")
    .action(async (id: string, opts: FmtOpts) => profiles.profileCampaigns(id, opts));

  // ── Products ────────────────────────────────────────────────────────────
  const prod = program.command("products").description("Product catalog");

  fmt(prod.command("get <id>"))
    .description("Get a product by ID (GET /products/:id)")
    .action(async (id: string, opts: FmtOpts) => products.getProduct(id, opts));

  fmt(prod.command("listings"))
    .description("Paginated product listings (GET /products/listings)")
    .option("--limit <n>", "Page size", (v: string) => Number.parseInt(v, 10))
    .option("--page <n>", "Page number", (v: string) => Number.parseInt(v, 10))
    .option("--channel <c>", "Filter by social channel")
    .option("--outlet <id>", "Filter by outlet ID")
    .action(async (opts: products.ListingsOpts) => products.listings(opts));

  fmt(prod.command("categories"))
    .description("Product counts by placement & channel (GET /products/categories)")
    .action(async (opts: FmtOpts) => products.categories(opts));

  return program;
}
