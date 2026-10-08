import { Command, Option } from "commander";
import { type ApiClientOpts, callTool, listTools, resolveClient, structured, TOOL } from "./client.ts";
import { configPath, readConfig, resolveMcpUrl } from "./config.ts";
import { emit, type OutputFormat, pickFmt } from "./format.ts";
import { downloadImage, joinPath, runSaves, type SaveJob, slug } from "./save.ts";

export const VERSION = "0.1.1";

type FmtOpts = { json?: boolean; ndjson?: boolean };

const withFmt = (cmd: Command) =>
  cmd.option("--json", "emit the full result as JSON").option("--ndjson", "one result per line");

/** Drop undefined so optional flags are simply absent from the tool call. */
const defined = (obj: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

const int = (name: string) => (value: string) => {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) throw new Error(`${name} takes a positive whole number (got "${value}")`);
  return n;
};

const DESTINATIONS = ["code", "design_tool", "doc", "reference_library", "chat", "other"];

/**
 * Options every search shares. `--intent`, `--destination` and `--for` are
 * Mobbin's relevance hints (task_intent, output_destination, output_tool);
 * keep them identical across the searches of one task.
 */
const withSearch = (cmd: Command) =>
  withFmt(
    cmd
      .option("--save <dir>", "download each result's high-resolution image into <dir> (links expire after 30 days)")
      .addOption(new Option("--image-format <fmt>", "image format").choices(["webp", "jpg"]))
      .option("--intent <sentence>", "one short sentence about the overall task (same for every search in it)")
      .addOption(new Option("--destination <kind>", "what the results feed into").choices(DESTINATIONS))
      .option("--for <product>", "product the results go into next, e.g. Figma"),
  );

const PLATFORM = () =>
  new Option("--platform <platform>", "ios or web").choices(["ios", "web"]).makeOptionMandatory();

interface SearchOpts extends FmtOpts {
  save?: string;
  imageFormat?: string;
  intent?: string;
  destination?: string;
  for?: string;
}

const hints = (o: SearchOpts) => ({
  image_format: o.imageFormat,
  task_intent: o.intent,
  output_destination: o.destination,
  output_tool: o.for,
});

interface Screen {
  id: string;
  image_url: string;
  mobbin_url: string;
  app_name: string;
  platform: string;
  saved?: string;
}
interface FlowScreen {
  screen_id: string;
  image_url: string;
  position: number;
  saved?: string;
}
interface Flow {
  id: string;
  name: string;
  actions?: string[];
  mobbin_url: string;
  app_name: string;
  platform: string;
  screen_count: number;
  screens?: FlowScreen[];
}
interface Section {
  id: string;
  image_url: string;
  mobbin_url: string;
  site_name: string;
  saved?: string;
}
interface SearchResult {
  query: string;
  page?: number;
  has_next_page?: boolean;
  screens?: Screen[];
  flows?: Flow[];
  sections?: Section[];
  ai_usage_notice?: { text: string; credits_used: number };
  save_failures?: string[];
}

/**
 * Print a search: rows for the list, then the paging hint and Mobbin's usage
 * notice, which its terms ask clients to show word for word.
 */
function printSearch(result: SearchResult, items: unknown[], fmt: OutputFormat, row: (x: unknown) => string): void {
  if (fmt === "json") return emit(result, fmt);
  emit(items, fmt, row);
  if (fmt !== "table") return;
  if (result.has_next_page) process.stdout.write(`(more results: add --page ${(result.page ?? 1) + 1})\n`);
  for (const failure of result.save_failures ?? []) process.stderr.write(`warning: ${failure}\n`);
  if (result.ai_usage_notice) process.stdout.write(`\n${result.ai_usage_notice.text}\n`);
}

const savedSuffix = (saved?: string) => (saved ? `  -> ${saved}` : "");

/**
 * Build the mobbin Commander program. Pure (no side effects on import) so the
 * `@mirage-cli/mobbin` wrapper can run it in-process.
 */
export function buildProgram(): Command {
  const program = new Command();
  program
    .name("mobbin")
    .description(
      "Mobbin CLI: search Mobbin's library of real app and website UI (screens, flows, website sections) over its MCP server",
    )
    .version(VERSION);

  const client = () => resolveClient();

  // ── session ─────────────────────────────────────────────────────────────
  program
    .command("login")
    .description("sign in through the browser (OAuth + PKCE); needs a Mobbin Pro, Team or Enterprise plan")
    .option("--port <n>", "loopback port for the callback", "53684")
    .option("--client-id <id>", "use an already registered OAuth client instead of registering one")
    .option("--no-browser", "print the sign-in URL instead of opening it")
    .action(async (o: { port: string; clientId?: string; browser: boolean }) => {
      const { login } = await import("./oauth.ts");
      const state = await login({ clientId: o.clientId, port: Number.parseInt(o.port, 10), noBrowser: !o.browser });
      console.log(`signed in to Mobbin (issuer ${state.issuer})`);
    });

  program
    .command("logout")
    .description("forget the saved session (revoke access in Mobbin's settings)")
    .action(async () => {
      const { logout } = await import("./oauth.ts");
      logout();
      console.log("logged out locally; to revoke the grant, see https://docs.mobbin.com/mcp/disconnect");
    });

  program
    .command("status")
    .description("show the MCP endpoint and whether you are signed in")
    .action(() => {
      const cfg = readConfig();
      const env = Boolean(process.env.MOBBIN_ACCESS_TOKEN?.trim());
      const out = {
        mcpUrl: resolveMcpUrl(),
        signedIn: Boolean(cfg.oauth) || env,
        via: env ? "MOBBIN_ACCESS_TOKEN" : cfg.oauth ? "mobbin login" : null,
        accessTokenExpiresAt: !env && cfg.oauth ? new Date(cfg.oauth.expiresAt).toISOString() : undefined,
        configPath: configPath(),
      };
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    });

  // ── search ──────────────────────────────────────────────────────────────
  withSearch(
    program
      .command("screens <query...>")
      .description("search single UI screens, e.g. `mobbin screens checkout with apple pay --platform ios`")
      .addOption(PLATFORM())
      .addOption(new Option("--mode <mode>", "deep (default, AI re-ranked, slower) or standard (fast)").choices(["deep", "standard"]))
      .option("--limit <n>", "results, 1-30 (default 20)", int("--limit"))
      .option("--exclude <ids>", "comma-separated screen ids to leave out (for a next batch)"),
  ).action(
    async (
      words: string[],
      o: SearchOpts & { platform: string; mode?: string; limit?: number; exclude?: string },
    ) => {
      const exclude = o.exclude
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const result = structured<SearchResult>(
        await callTool(
          await client(),
          TOOL.screens,
          defined({
            query: words.join(" "),
            platform: o.platform,
            mode: o.mode,
            limit: o.limit,
            exclude_screen_ids: exclude?.length ? exclude : undefined,
            ...hints(o),
          }),
        ),
      );
      const screens = result.screens ?? [];
      if (o.save) {
        const dir = o.save;
        const jobs: SaveJob[] = screens.map((s) => ({
          url: s.image_url,
          pathWithoutExt: joinPath(dir, `${slug(s.app_name)}-${s.id.slice(0, 8)}`),
          done: (path) => {
            s.saved = path;
          },
        }));
        const failures = await runSaves(jobs, o.imageFormat ?? "webp");
        if (failures.length) result.save_failures = failures;
      }
      printSearch(result, screens, pickFmt(o), (x) => {
        const s = x as Screen;
        return `${s.app_name} (${s.platform})  ${s.mobbin_url}${savedSuffix(s.saved)}\n`;
      });
    },
  );

  withSearch(
    program
      .command("flows <query...>")
      .description("search multi-step user flows, e.g. `mobbin flows duolingo onboarding --platform ios`")
      .addOption(PLATFORM())
      .option("--limit <n>", "flows, 1-10 (default 5)", int("--limit"))
      .option("--page <n>", "page of results, 1-20", int("--page")),
  ).action(async (words: string[], o: SearchOpts & { platform: string; limit?: number; page?: number }) => {
    const result = structured<SearchResult>(
      await callTool(
        await client(),
        TOOL.flows,
        defined({ query: words.join(" "), platform: o.platform, limit: o.limit, page: o.page, ...hints(o) }),
      ),
    );
    const flows = result.flows ?? [];
    if (o.save) {
      const dir = o.save;
      const jobs: SaveJob[] = flows.flatMap((f) =>
        (f.screens ?? []).map((s) => ({
          url: s.image_url,
          pathWithoutExt: joinPath(
            dir,
            `${slug(f.app_name)}-${slug(f.name, 30)}-${f.id.slice(0, 8)}/${String(s.position).padStart(2, "0")}`,
          ),
          done: (path: string) => {
            s.saved = path;
          },
        })),
      );
      const failures = await runSaves(jobs, o.imageFormat ?? "webp");
      if (failures.length) result.save_failures = failures;
    }
    printSearch(result, flows, pickFmt(o), (x) => {
      const f = x as Flow;
      const folder = f.screens?.find((s) => s.saved)?.saved?.replace(/\/[^/]+$/, "");
      return `${f.app_name}: ${f.name} (${f.platform}, ${f.screen_count} screens)  ${f.mobbin_url}${savedSuffix(folder)}\n`;
    });
  });

  withSearch(
    program
      .command("sections <query...>")
      .description("search website sections (pricing, footer, hero...), e.g. `mobbin sections pricing with three tiers`")
      .option("--limit <n>", "results, 1-30 (default 20)", int("--limit"))
      .option("--page <n>", "page of results", int("--page")),
  ).action(async (words: string[], o: SearchOpts & { limit?: number; page?: number }) => {
    const result = structured<SearchResult>(
      await callTool(
        await client(),
        TOOL.sections,
        defined({ query: words.join(" "), limit: o.limit, page: o.page, ...hints(o) }),
      ),
    );
    const sections = result.sections ?? [];
    if (o.save) {
      const dir = o.save;
      const jobs: SaveJob[] = sections.map((s) => ({
        url: s.image_url,
        pathWithoutExt: joinPath(dir, `${slug(s.site_name)}-${s.id.slice(0, 8)}`),
        done: (path) => {
          s.saved = path;
        },
      }));
      const failures = await runSaves(jobs, o.imageFormat ?? "webp");
      if (failures.length) result.save_failures = failures;
    }
    printSearch(result, sections, pickFmt(o), (x) => {
      const s = x as Section;
      return `${s.site_name}  ${s.mobbin_url}${savedSuffix(s.saved)}\n`;
    });
  });

  program
    .command("download <image_url> <path>")
    .description("save one result's image_url to <path> (extension added from the image type)")
    .action(async (url: string, path: string) => {
      const written = await downloadImage(url, path.replace(/\.(webp|jpe?g|png)$/i, ""));
      console.log(written);
    });

  // ── escape hatches ─────────────────────────────────────────────────────
  withFmt(program.command("tools").description("list the MCP tools Mobbin exposes")).action(async (o: FmtOpts) =>
    emit(await listTools(await client()), pickFmt(o), (t) => `${(t as { name: string }).name}\n`),
  );

  program
    .command("call <tool> [json]")
    .description("call any Mobbin MCP tool with a JSON object of arguments; prints the structured result")
    .action(async (tool: string, json: string | undefined) => {
      const c: ApiClientOpts = await client();
      const result = await callTool(c, tool, json ? (JSON.parse(json) as Record<string, unknown>) : {});
      emit(result.structuredContent ?? result.content?.filter((b) => b.type === "text"), "json");
    });

  return program;
}
