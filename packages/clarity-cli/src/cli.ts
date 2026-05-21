import { Command, Option } from "commander";
import { setToken, clearToken, getToken, maskToken, configPath } from "./config.ts";
import {
  askDashboard, listRecordings, queryDocs, projectLiveInsights,
} from "./api.ts";
import { buildFilters, type SessionFlags } from "./filters.ts";
import { formatOutput } from "./formatter.ts";
import type { InsightsDimension, SortBy } from "./types.ts";

function addSessionFlags(cmd: Command): Command {
  return cmd
    .option("--days <n>", "Lookback window in days (default 3)", (v: string) => parseInt(v, 10))
    .option("--from <YYYY-MM-DD>", "Start date")
    .option("--to <YYYY-MM-DD>", "End date")
    .option("--url-contains <s>", "Filter to sessions that visited a URL matching this substring")
    .option("--entry-url <s>", "Filter by entry/landing page URL substring")
    .option("--exit-url <s>", "Filter by exit page URL substring")
    .option("--device <type...>", "Mobile|Tablet|PC|Email|Other (repeatable)")
    .option("--browser <name...>", "Chrome|Safari|Edge|Firefox|… (repeatable)")
    .option("--os <name...>", "Windows|MacOS|iOS|Android|Linux|… (repeatable)")
    .option("--country <name...>", "Country name(s), e.g. 'United States'")
    .option("--city <name...>", "City name(s)")
    .option("--user-type <type>", "new|returning")
    .option("--intent <level>", "low|medium|high")
    .option("--channel <name...>", "OrganicSearch|Direct|Social|PaidSearch|AITools|PaidAITools|… (repeatable)")
    .option("--source <s...>", "UTM source (repeatable)")
    .option("--medium <s...>", "UTM medium (repeatable)")
    .option("--campaign <s...>", "UTM campaign (repeatable)")
    .option("--smart-event <name...>", "Smart event name (repeatable); e.g. Purchase, SignUp")
    .option("--rage-clicks", "Only sessions with rage clicks")
    .option("--dead-clicks", "Only sessions with dead clicks")
    .option("--quickback-clicks", "Only sessions with quick-back clicks")
    .option("--excessive-scroll", "Only sessions with excessive scrolling")
    .option("--js-errors", "Only sessions with JS errors")
    .option("--click-errors", "Only sessions with click errors")
    .option("--min-duration <sec>", "Min session duration in seconds", (v: string) => parseInt(v, 10))
    .option("--max-duration <sec>", "Max session duration in seconds", (v: string) => parseInt(v, 10))
    .option("--min-scroll <pct>", "Min scroll depth (0-100)", (v: string) => parseInt(v, 10))
    .option("--max-scroll <pct>", "Max scroll depth (0-100)", (v: string) => parseInt(v, 10))
    .option("--clicked-text <s>", "Text that was clicked (partial match)")
    .option("--product-name <s>", "Product name (e-commerce)")
    .option("--product-purchases", "Only sessions with product purchases")
    .addOption(new Option("--sort <mode>", "Sort order").choices([
      "SessionStart_DESC", "SessionStart_ASC",
      "SessionDuration_ASC", "SessionDuration_DESC",
      "SessionClickCount_ASC", "SessionClickCount_DESC",
      "PageCount_ASC", "PageCount_DESC",
    ]).default("SessionStart_DESC"))
    .option("-n, --count <n>", "Max sessions (1-250, default 100)", (v: string) => parseInt(v, 10), 100)
    .option("--json", "Raw JSON output")
    .option("--csv", "CSV output (tabular responses only)");
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("clarity")
    .description("Query Microsoft Clarity analytics — dashboard, session recordings, AI-traffic visibility, and docs.")
    .version("0.1.0")
    .option("--token <token>", "Clarity API token (overrides config and env)");

  const auth = program.command("auth").description("Manage Clarity API token");
  auth
    .argument("[token]", "API token to save")
    .option("--show", "Show currently-configured token (masked)")
    .option("--clear", "Remove stored token")
    .action((token: string | undefined, opts: { show?: boolean; clear?: boolean }) => {
      if (opts.clear) {
        clearToken();
        console.log("Token cleared.");
        return;
      }
      if (opts.show) {
        const t = getToken();
        if (!t) {
          console.log("No token configured.");
          console.log(`Config path: ${configPath()}`);
          process.exit(1);
        }
        console.log(`Token: ${maskToken(t)}`);
        console.log(`Source: ${process.env.CLARITY_API_TOKEN ? "env CLARITY_API_TOKEN" : configPath()}`);
        return;
      }
      if (!token) {
        auth.help();
      }
      setToken(token!);
      console.log(`Token saved to ${configPath()}`);
    });

  program
    .command("ask")
    .description("Natural-language Clarity dashboard query (e.g., 'top browsers last 3 days')")
    .argument("<question>", "Query in natural language")
    .option("--json", "Raw JSON output")
    .option("--csv", "CSV output (tabular responses only)")
    .action(async (question: string, opts: { json?: boolean }) => {
      const result = await askDashboard(question, program.opts().token);
      console.log(formatOutput(result, opts));
    });

  addSessionFlags(
    program
      .command("sessions")
      .description("List Clarity session recordings (returns playable clarity.microsoft.com URLs)"),
  ).action(async (opts: SessionFlags & { sort: SortBy; count: number; json?: boolean; csv?: boolean }) => {
    const filters = buildFilters(opts);
    const result = await listRecordings(filters, opts.sort, opts.count, program.opts().token);
    console.log(formatOutput(result, opts));
  });

  program
    .command("ai-traffic")
    .description("Dashboard summary of AI-referral traffic (ChatGPT, Perplexity, etc.)")
    .option("--days <n>", "Lookback in days", (v: string) => parseInt(v, 10), 7)
    .option("--paid", "Include only PaidAITools channel")
    .option("--json", "Raw JSON output")
    .option("--csv", "CSV output (tabular responses only)")
    .action(async (opts: { days: number; paid?: boolean; json?: boolean }) => {
      const channel = opts.paid ? "PaidAITools" : "AITools and PaidAITools";
      const q = `Traffic from channel ${channel} for the last ${opts.days} days, broken down by source and landing page`;
      const result = await askDashboard(q, program.opts().token);
      console.log(formatOutput(result, opts));
    });

  program
    .command("ai-sessions")
    .description("Session recordings from AI-referral channels")
    .option("--days <n>", "Lookback in days", (v: string) => parseInt(v, 10), 7)
    .option("--paid", "Include only PaidAITools channel")
    .option("-n, --count <n>", "Max sessions", (v: string) => parseInt(v, 10), 50)
    .option("--json", "Raw JSON output")
    .option("--csv", "CSV output (tabular responses only)")
    .action(async (opts: { days: number; paid?: boolean; count: number; json?: boolean }) => {
      const channel = opts.paid ? ["PaidAITools"] : ["AITools", "PaidAITools"];
      const filters = buildFilters({ days: opts.days, channel });
      const result = await listRecordings(filters, "SessionStart_DESC", opts.count, program.opts().token);
      console.log(formatOutput(result, opts));
    });

  program
    .command("docs")
    .description("Search the Microsoft Clarity documentation")
    .argument("<question>", "Docs question in natural language")
    .option("--json", "Raw JSON output")
    .option("--csv", "CSV output (tabular responses only)")
    .action(async (question: string, opts: { json?: boolean }) => {
      const result = await queryDocs(question, program.opts().token);
      console.log(formatOutput(result, opts));
    });

  program
    .command("insights")
    .description("Official Clarity Data Export API aggregate (rate-limited: 10/day, 1-3 day lookback)")
    .option("--days <1|2|3>", "Number of days (1, 2, or 3)", (v: string) => parseInt(v, 10), 1)
    .option("--dim1 <dim>", "First breakdown dimension")
    .option("--dim2 <dim>", "Second breakdown dimension")
    .option("--dim3 <dim>", "Third breakdown dimension")
    .option("--json", "Raw JSON output")
    .option("--csv", "CSV output (tabular responses only)")
    .action(async (opts: {
      days: number; dim1?: string; dim2?: string; dim3?: string; json?: boolean;
    }) => {
      if (![1, 2, 3].includes(opts.days)) {
        console.error("--days must be 1, 2, or 3");
        process.exit(1);
      }
      const dims = [opts.dim1, opts.dim2, opts.dim3].filter(Boolean) as InsightsDimension[];
      const result = await projectLiveInsights(opts.days as 1 | 2 | 3, dims, program.opts().token);
      console.log(formatOutput(result, opts));
    });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const askShortcut = (question: (opts: any) => string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (opts: any) => {
      const result = await askDashboard(question(opts), program.opts().token);
      console.log(formatOutput(result, opts));
    };

  program
    .command("traffic")
    .description("Traffic summary (shortcut for 'ask')")
    .option("--days <n>", "Lookback in days", (v: string) => parseInt(v, 10), 7)
    .option("--by <dim>", "Breakdown dimension: OS|Country|Channel|Device|Browser")
    .option("--json", "Raw JSON output")
    .option("--csv", "CSV output (tabular responses only)")
    .action(askShortcut(
      (o) => o.by
        ? `Traffic for the last ${o.days} days broken down by ${o.by}`
        : `Total traffic for the last ${o.days} days`,
    ));

  program
    .command("top-pages")
    .description("Top pages by views")
    .option("--days <n>", "Lookback in days", (v: string) => parseInt(v, 10), 7)
    .option("--device <d>", "Device filter: Mobile|Tablet|PC")
    .option("--json", "Raw JSON output")
    .option("--csv", "CSV output (tabular responses only)")
    .action(askShortcut(
      (o) => o.device
        ? `Top pages for ${o.device} in the last ${o.days} days`
        : `Top pages for the last ${o.days} days`,
    ));

  program
    .command("web-vitals")
    .description("Core Web Vitals summary (LCP, FID, CLS)")
    .option("--days <n>", "Lookback in days", (v: string) => parseInt(v, 10), 7)
    .option("--device <d>", "Device filter: Mobile|Tablet|PC")
    .option("--json", "Raw JSON output")
    .option("--csv", "CSV output (tabular responses only)")
    .action(askShortcut(
      (o) => `Average largest contentful paint, first input delay, and cumulative layout shift for ${o.device || "all devices"} in the last ${o.days} days`,
    ));

  program
    .command("errors")
    .description("Top JavaScript errors")
    .option("--days <n>", "Lookback in days", (v: string) => parseInt(v, 10), 7)
    .option("--device <d>", "Device filter")
    .option("--json", "Raw JSON output")
    .option("--csv", "CSV output (tabular responses only)")
    .action(askShortcut(
      (o) => `Top javascript errors ${o.device ? `on ${o.device}` : ""} in the last ${o.days} days`,
    ));

  return program;
}
