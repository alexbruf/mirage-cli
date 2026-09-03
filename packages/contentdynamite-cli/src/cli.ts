import { Command } from "commander";
import { reportCost } from "@mirage-cli/core";
import { ContentDynamiteApiError, ContentDynamiteClient } from "./client.ts";
import { readBinaryFile, readTextFile, writeTextFile } from "./fileio.ts";
import {
  interactiveFields,
  jobsToCsv,
  splitCsv,
  wireArticleStatus,
  wireLandingStatus,
  wirePageType,
} from "./wire.ts";

interface GlobalOptions {
  token?: string;
  url?: string;
  pretty?: boolean;
}

const FILE_TYPES = ["image", "csv"];

export function buildProgram(): Command {
  const program = new Command()
    .name("ve-dynamite")
    .description(
      "Content Dynamite CLI: SEO articles, BOFU landing pages, company profiles, ICP, and featured images.",
    )
    .version("0.1.0")
    .option("--token <token>", "Access token override (or set VE_DYNAMITE_TOKEN)")
    .option("--url <url>", "API base URL (or set VE_DYNAMITE_API_URL)")
    .option("--pretty", "Pretty print JSON output")
    .addHelpText(
      "after",
      `
Environment:
  VE_DYNAMITE_TOKEN    ved_ API token (mint one with \`tokens create\`) or a 24h JWT
  VE_DYNAMITE_API_URL  override the production API base URL

Notes:
  Article and landing page generation is asynchronous and spends real money per item.
  Generation status polls use \`get\`; a completed article reports status "sucess" on the wire.
  Destructive commands require an explicit --yes.

Examples:
  ve-dynamite whoami
  ve-dynamite profiles list
  ve-dynamite articles write --profile-id 3 --query "best gravel driveway" --primary-keywords "gravel driveway"
  ve-dynamite articles get 424246
  ve-dynamite landing-pages write --profile-id 3 --keyword "buy pea gravel" --page-type single_product --cta-label "Get a quote"
  ve-dynamite landing-pages export 424246 --html -o page.html`,
    );

  const globalOptions = (): GlobalOptions => program.opts<GlobalOptions>();

  const auth = (): { token: string; baseUrl?: string } => {
    const options = globalOptions();
    const token = options.token ?? process.env.VE_DYNAMITE_TOKEN;
    if (!token) {
      throw new Error("Missing API token. Set VE_DYNAMITE_TOKEN or pass --token.");
    }
    const baseUrl = options.url ?? process.env.VE_DYNAMITE_API_URL;
    return { token, ...(baseUrl ? { baseUrl } : {}) };
  };

  const client = (): ContentDynamiteClient => new ContentDynamiteClient(auth());

  const json = (value: unknown): void => {
    process.stdout.write(JSON.stringify(value, null, globalOptions().pretty ? 2 : undefined) + "\n");
  };

  const note = (message: string): void => {
    process.stderr.write(message + "\n");
  };

  const billed = (units: number): void => {
    reportCost({ provider: "contentdynamite", units });
  };

  const run = <T extends unknown[]>(action: (...args: T) => Promise<void>) =>
    async (...args: T): Promise<void> => {
      try {
        await action(...args);
      } catch (error) {
        fail(error);
      }
    };

  program
    .command("whoami")
    .description("Validate the token against the API and print the signed in identity")
    .action(
      run(async () => {
        const { token } = auth();
        try {
          await client().get("company-profile/");
        } catch (error) {
          if (error instanceof ContentDynamiteApiError && error.status === 401) {
            throw new Error("not authenticated, the token was rejected by the API");
          }
          throw error;
        }
        const payload = decodeJwtPayload(token);
        const exp = typeof payload?.exp === "number" ? payload.exp : null;
        json({
          user_id: payload?.user_id ?? null,
          token_type: token.startsWith("ved_") ? "pat" : "jwt",
          expires_at: exp ? new Date(exp * 1000).toISOString() : null,
        });
      }),
    );

  const tokens = program
    .command("tokens")
    .description("Manage long lived API tokens for MCP, CI, and mount usage");
  tokens
    .command("create")
    .description("Create a long lived API token (the raw token is shown once, store it now)")
    .requiredOption("--name <name>", "Token label, e.g. ve-brain-mount")
    .option("--expires-days <days>", "Days until the token expires (omit for a token that never expires)")
    .action(
      run(async (options: { name: string; expiresDays?: string }) => {
        const body: Record<string, unknown> = { name: options.name };
        if (options.expiresDays !== undefined) {
          body.expires_in_days = toInt(options.expiresDays, "expires days");
        }
        const res = await client().post<{ token: string }>("api-tokens/", body);
        note("Token created. This is the only time it is shown, store it now.");
        json(res);
      }),
    );
  tokens
    .command("list")
    .description("List your API tokens (masked, includes revoked ones)")
    .action(run(async () => json(await client().get("api-tokens/"))));
  tokens
    .command("revoke <token-id>")
    .description("Revoke an API token by id")
    .action(run(async (tokenId: string) => json(await client().delete(`api-tokens/${tokenId}`))));

  const profiles = program.command("profiles").description("Manage company profiles");
  profiles
    .command("create")
    .description("Create a company profile (also starts async ICP generation, which costs money)")
    .requiredOption("--name <name>", "Company name")
    .requiredOption("--website <website>", "Company website, bare host like example.com (scheme is stripped)")
    .option("--sitemap <url>", "Sitemap URL, bare host form")
    .option("--writing-guide <guide>", "Writing style guide")
    .action(
      run(async (options: { name: string; website: string; sitemap?: string; writingGuide?: string }) => {
        const body: Record<string, unknown> = {
          name: options.name,
          website_url: stripScheme(options.website),
        };
        if (options.sitemap) body.sitemap_url = stripScheme(options.sitemap);
        if (options.writingGuide) body.writing_guide = options.writingGuide;
        const res = await client().post("company-profile/create", body);
        billed(1);
        note("ICP generation started in the background, check progress with `ve-dynamite icp show <id>`");
        json(res);
      }),
    );
  profiles
    .command("list")
    .description("List all company profiles")
    .action(run(async () => json(await client().get("company-profile/"))));
  profiles
    .command("get <profile-id>")
    .description("Show one company profile")
    .action(run(async (profileId: string) => json(await findProfile(client(), profileId))));
  profiles
    .command("update <profile-id>")
    .description("Update profile fields (only the flags you pass are changed)")
    .option("--name <name>", "New company name")
    .option("--website <website>", "New website, bare host form (scheme is stripped)")
    .option("--sitemap <url>", "New sitemap URL")
    .option("--writing-guide <guide>", "New writing style guide")
    .action(
      run(
        async (
          profileId: string,
          options: { name?: string; website?: string; sitemap?: string; writingGuide?: string },
        ) => {
          const body: Record<string, unknown> = {};
          if (options.name) body.name = options.name;
          if (options.website) body.website_url = stripScheme(options.website);
          if (options.sitemap) body.sitemap_url = stripScheme(options.sitemap);
          if (options.writingGuide) body.writing_guide = options.writingGuide;
          if (Object.keys(body).length === 0) {
            throw new Error(
              "nothing to update, pass at least one of --name, --website, --sitemap, --writing-guide",
            );
          }
          json(await client().put(`company-profile/${profileId}`, body));
        },
      ),
    );
  profiles
    .command("delete <profile-id>")
    .description("Delete a profile and everything under it (articles, ICP, categories)")
    .option("--yes", "Confirm the deletion")
    .action(
      run(async (profileId: string, options: { yes?: boolean }) => {
        if (!options.yes) {
          throw new Error("deleting a profile also deletes its articles, re-run with --yes to confirm");
        }
        json(await client().delete(`company-profile/${profileId}`));
      }),
    );

  const icp = program
    .command("icp")
    .description("Manage a profile's ICP (ideal customer profile)");
  icp
    .command("show <profile-id>")
    .description("Show the ICP, or its generation status when not ready")
    .action(
      run(async (profileId: string) => {
        const profile = await findProfile(client(), profileId);
        const parsed = parseIcp(profile.icp);
        json(parsed ?? { status: profile.icp });
      }),
    );
  icp
    .command("regenerate <profile-id>")
    .description("Regenerate the ICP from the website (async, costs money)")
    .action(
      run(async (profileId: string) => {
        const res = await client().post(`company-profile/${profileId}/regenerate-icp`);
        billed(1);
        note("ICP regeneration started in the background, check progress with `ve-dynamite icp show <id>`");
        json(res);
      }),
    );
  icp
    .command("update <profile-id>")
    .description("Edit ICP sections directly (only the flags you pass are changed)")
    .option("--business-overview <text>", "Business overview section")
    .option("--customer-profile <text>", "Customer profile section")
    .option("--channel-analysis <text>", "Channel analysis section")
    .option("--pain-points <text>", "Pain points section")
    .option("--intent-funnel <text>", "Intent funnel section")
    .option("--competitive-landscape <text>", "Competitive landscape section")
    .action(
      run(
        async (
          profileId: string,
          options: {
            businessOverview?: string;
            customerProfile?: string;
            channelAnalysis?: string;
            painPoints?: string;
            intentFunnel?: string;
            competitiveLandscape?: string;
          },
        ) => {
          const fields: Record<string, string | undefined> = {
            business_overview: options.businessOverview,
            customer_profile: options.customerProfile,
            channel_analysis: options.channelAnalysis,
            pain_points: options.painPoints,
            intent_funnel: options.intentFunnel,
            competitive_landscape: options.competitiveLandscape,
          };
          const body: Record<string, string> = {};
          for (const [key, value] of Object.entries(fields)) {
            if (value !== undefined) body[key] = value;
          }
          if (Object.keys(body).length === 0) {
            throw new Error(
              "nothing to update, pass at least one of --business-overview, --customer-profile, --channel-analysis, --pain-points, --intent-funnel, --competitive-landscape",
            );
          }
          json(await client().put(`company-profile/${profileId}/icp`, body));
        },
      ),
    );

  const categories = program
    .command("categories")
    .description("Manage a profile's article categories");
  categories
    .command("list <profile-id>")
    .description("List categories with article counts")
    .action(run(async (profileId: string) => json(await client().get(`company-profile/${profileId}/categories`))));
  categories
    .command("add <profile-id> <names...>")
    .description("Add one or more categories (no commas in names)")
    .action(
      run(async (profileId: string, names: string[]) =>
        json(await client().post(`company-profile/${profileId}/categories`, { categories: names })),
      ),
    );

  const articles = program.command("articles").description("Manage articles");
  articles
    .command("write")
    .description("Queue an article for generation (async, costs real money per article)")
    .requiredOption("--profile-id <id>", "Company profile id")
    .requiredOption("--query <query>", "Search query the article should target")
    .requiredOption("--primary-keywords <keywords>", "Primary keywords")
    .option("--secondary-keywords <keywords>", "Secondary keywords")
    .option("--location <location>", "Location to rank for")
    .option("--guidelines <text>", "Extra writing guidelines")
    .option("--image-guideline <text>", "Featured image guideline")
    .option("--internal-links <urls>", "Comma separated internal link URLs")
    .option("--competitor-links <urls>", "Comma separated competitor URLs (max 3)")
    .option("--infographic", "Generate the featured image as an infographic")
    .option("--video", "Generate a companion video")
    .option(
      "--interactive [type]",
      "Generate an interactive component, optionally quiz | game | calculator (bare flag lets the server auto select)",
    )
    .action(
      run(
        async (options: {
          profileId: string;
          query: string;
          primaryKeywords: string;
          secondaryKeywords?: string;
          location?: string;
          guidelines?: string;
          imageGuideline?: string;
          internalLinks?: string;
          competitorLinks?: string;
          infographic?: boolean;
          video?: boolean;
          interactive?: string | boolean;
        }) => {
          const body: Record<string, unknown> = {
            company_profile_id: toInt(options.profileId, "profile id"),
            search_query: options.query,
            primary_keywords: options.primaryKeywords,
          };
          if (options.secondaryKeywords) body.secondary_keywords = options.secondaryKeywords;
          if (options.location) body.location_to_rank_for = options.location;
          if (options.guidelines) body.extra_guidelines = options.guidelines;
          if (options.imageGuideline) body.image_guideline = options.imageGuideline;
          if (options.internalLinks) body.internal_links = splitCsv(options.internalLinks);
          if (options.competitorLinks) {
            const links = splitCsv(options.competitorLinks);
            if (links.length > 3) {
              throw new Error(`competitor links max out at 3, got ${links.length}`);
            }
            body.competitor_links = links;
          }
          if (options.infographic) body.infographic_feat_image = true;
          if (options.video) body.generate_video = true;
          Object.assign(body, interactiveFields(options.interactive));
          const res = await client().post<{ article_id: number }>("content-writing/article", body);
          billed(1);
          note(
            `Generation is asynchronous and spends real money (LLM, SERP, crawling, images). Poll with \`ve-dynamite articles get ${res.article_id}\``,
          );
          json(res);
        },
      ),
    );
  articles
    .command("get <article-id>")
    .description("Show one article (slim {article_id, status} shape until the article completes)")
    .action(run(async (articleId: string) => json(await client().get(`content-writing/article/${articleId}`))));
  articles
    .command("list")
    .description("List articles, newest first (a completed article reports the wire status \"sucess\")")
    .option("--page <n>", "Page number", "1")
    .option("--limit <n>", "Page size (max 100)", "10")
    .option("--company <name>", "Filter by exact company name")
    .option("--status <status>", "Filter by status: pending, success, failed")
    .option("--batch-id <id>", "Filter by batch id")
    .action(
      run(
        async (options: { page: string; limit: string; company?: string; status?: string; batchId?: string }) => {
          json(
            await client().get("content-writing/articles", {
              page: toInt(options.page, "page"),
              limit: toInt(options.limit, "limit"),
              company_name: options.company,
              status: wireArticleStatus(options.status),
              batch_id: options.batchId,
            }),
          );
        },
      ),
    );
  articles
    .command("update <article-id>")
    .description("Update article fields (409 while the article is still being written)")
    .option("--title <title>", "New title")
    .option("--slug <slug>", "New slug")
    .option("--intro <intro>", "New intro")
    .option("--body <markdown>", "New body markdown")
    .option("--body-file <path>", "Read the new body from a file")
    .option("--faqs <faqs>", "New FAQs")
    .option("--faqs-file <path>", "Read the new FAQs from a file")
    .option("--feat-image <url>", "New featured image URL")
    .action(
      run(
        async (
          articleId: string,
          options: {
            title?: string;
            slug?: string;
            intro?: string;
            body?: string;
            bodyFile?: string;
            faqs?: string;
            faqsFile?: string;
            featImage?: string;
          },
        ) => {
          if (options.body && options.bodyFile) {
            throw new Error("pass either --body or --body-file, not both");
          }
          if (options.faqs && options.faqsFile) {
            throw new Error("pass either --faqs or --faqs-file, not both");
          }
          const payload: Record<string, unknown> = {};
          if (options.title) payload.title = options.title;
          if (options.slug) payload.slug = options.slug;
          if (options.intro) payload.intro = options.intro;
          const body = options.bodyFile ? await readTextFile(options.bodyFile) : options.body;
          if (body) payload.body = body;
          const faqs = options.faqsFile ? await readTextFile(options.faqsFile) : options.faqs;
          if (faqs) payload.faqs = faqs;
          if (options.featImage) payload.feat_image = options.featImage;
          if (Object.keys(payload).length === 0) {
            throw new Error(
              "nothing to update, pass at least one of --title, --slug, --intro, --body, --body-file, --faqs, --faqs-file, --feat-image",
            );
          }
          json(await client().put(`content-writing/article/${articleId}`, payload));
        },
      ),
    );
  articles
    .command("delete <article-id>")
    .description("Delete an article permanently")
    .option("--yes", "Confirm the deletion")
    .action(
      run(async (articleId: string, options: { yes?: boolean }) => {
        if (!options.yes) {
          throw new Error("deleting an article is permanent, re-run with --yes to confirm");
        }
        json(await client().delete(`content-writing/article/${articleId}`));
      }),
    );
  articles
    .command("export")
    .description("Export all matching articles via client side paging")
    .option("--company <name>", "Filter by exact company name")
    .option("--status <status>", "Filter by status: pending, success, failed")
    .option("--batch-id <id>", "Filter by batch id")
    .option("--ndjson", "Newline delimited JSON instead of an array")
    .option("-o, --output <path>", "Write to a file instead of stdout")
    .action(
      run(
        async (options: { company?: string; status?: string; batchId?: string; ndjson?: boolean; output?: string }) => {
          const c = client();
          const wire = wireArticleStatus(options.status);
          const collected: unknown[] = [];
          let page = 1;
          for (;;) {
            const res = await c.get<{ articles: unknown[]; total_pages: number }>("content-writing/articles", {
              page,
              limit: 100,
              company_name: options.company,
              status: wire,
              batch_id: options.batchId,
            });
            collected.push(...res.articles);
            if (page >= res.total_pages || res.articles.length === 0) break;
            page += 1;
          }
          let text: string;
          if (options.ndjson) {
            text = collected.map((article) => JSON.stringify(article)).join("\n");
            if (text) text += "\n";
          } else {
            text = JSON.stringify(collected, null, 2);
          }
          if (options.output) {
            await writeTextFile(options.output, text);
            note(`exported ${collected.length} articles to ${options.output}`);
          } else {
            process.stdout.write(text.endsWith("\n") || text === "" ? text : text + "\n");
          }
        },
      ),
    );

  const batches = program.command("batches").description("Manage article batches");
  batches
    .command("create")
    .description("Queue a batch of articles (async, costs real money PER ARTICLE)")
    .requiredOption("--name <name>", "Batch name (unique per user)")
    .option("--csv <path>", "CSV file of jobs")
    .option("--jobs <path>", "JSON file with an array of job objects")
    .option("--guidelines <text>", "Batch wide extra writing guidelines")
    .option("--image-guideline <text>", "Batch wide featured image guideline")
    .option("--infographic", "Batch wide infographic featured images")
    .option("--video", "Batch wide companion videos")
    .option("--interactive [type]", "Batch wide interactive components, optionally quiz | game | calculator")
    .action(
      run(
        async (options: {
          name: string;
          csv?: string;
          jobs?: string;
          guidelines?: string;
          imageGuideline?: string;
          infographic?: boolean;
          video?: boolean;
          interactive?: string | boolean;
        }) => {
          if (Boolean(options.csv) === Boolean(options.jobs)) {
            throw new Error("pass exactly one of --csv or --jobs");
          }
          let csvBytes: Uint8Array;
          let filename: string;
          if (options.csv) {
            csvBytes = new TextEncoder().encode(await readTextFile(options.csv));
            const name = basename(options.csv);
            filename = name.endsWith(".csv") ? name : "batch.csv";
          } else {
            csvBytes = jobsToCsv(JSON.parse(await readTextFile(options.jobs as string)));
            filename = "batch.csv";
          }
          const params: Record<string, string | boolean> = { batch_name: options.name };
          if (options.guidelines) params.extra_guidelines = options.guidelines;
          if (options.imageGuideline) params.image_guideline = options.imageGuideline;
          if (options.infographic) params.infographic_feat_image = true;
          if (options.video) params.generate_video = true;
          for (const [key, value] of Object.entries(interactiveFields(options.interactive))) {
            params[key] = value as string | boolean;
          }
          const res = await client().postForm<{ total: number; batch_id: number }>(
            "content-writing/articles/batch",
            filename,
            csvBytes,
            "text/csv",
            params,
          );
          billed(res.total);
          note(
            `Queued ${res.total} articles, each spends real money (LLM, SERP, crawling, images). Poll with \`ve-dynamite batches get ${res.batch_id}\``,
          );
          json(res);
        },
      ),
    );
  batches
    .command("list")
    .description("List your batches with progress counters")
    .action(run(async () => json(await client().get("content-writing/batches"))));
  batches
    .command("get <batch-id>")
    .description("Show one batch with its member articles")
    .action(
      run(async (batchId: string) => {
        const c = client();
        const batch = await findBatch(c, batchId);
        json({ ...batch, articles: await pageArticles(c, batchId) });
      }),
    );
  batches
    .command("delete <batch-id>")
    .description("Delete a batch permanently")
    .option("--yes", "Confirm the deletion")
    .action(
      run(async (batchId: string, options: { yes?: boolean }) => {
        if (!options.yes) {
          throw new Error("deleting a batch is permanent, re-run with --yes to confirm");
        }
        json(await client().delete(`content-writing/batch/${batchId}`));
      }),
    );

  const landingPages = program
    .command("landing-pages")
    .description("Manage BOFU SEO landing pages");
  landingPages
    .command("write")
    .description("Queue a landing page for generation (async, costs real money per page)")
    .requiredOption("--profile-id <id>", "Company profile id")
    .requiredOption("--keyword <keyword>", "The purchase intent keyword this page targets")
    .requiredOption(
      "--page-type <type>",
      "single_product | multiple_products | alternative | blog_paste | minimal",
    )
    .requiredOption("--cta-label <label>", "Call to action button label")
    .option("--cta-url <url>", "Call to action destination URL")
    .option("--secondary-keywords <keywords>", "Comma separated secondary keywords (max 2)")
    .option(
      "--intent-who <text>",
      "Who is searching this keyword (skips the intent LLM step when all three intent flags are set)",
    )
    .option("--intent-want <text>", "What the searcher wants")
    .option("--intent-achieve <text>", "What the searcher is trying to achieve")
    .option("--brand-facts <text>", "Verified brand facts the writer may state")
    .option("--writing-guide <guide>", "Brand writing guide (source of truth over generic style rules)")
    .option("--writing-guide-file <path>", "Read the writing guide from a file")
    .option(
      "--image-urls <urls>",
      "Comma separated image URLs (first is the hero; each is rehosted to the CDN, remaining slots are AI generated)",
    )
    .option(
      "--no-images",
      "Ship slots without a supplied URL as placeholders instead of generating images (export is blocked until fixed)",
    )
    .option("--allowed-terms <terms>", "Comma separated banned list exceptions for this page")
    .option("--golden-url <url>", "URL of a golden reference page for the judge")
    .action(
      run(
        async (options: {
          profileId: string;
          keyword: string;
          pageType: string;
          ctaLabel: string;
          ctaUrl?: string;
          secondaryKeywords?: string;
          intentWho?: string;
          intentWant?: string;
          intentAchieve?: string;
          brandFacts?: string;
          writingGuide?: string;
          writingGuideFile?: string;
          imageUrls?: string;
          images: boolean;
          allowedTerms?: string;
          goldenUrl?: string;
        }) => {
          if (options.writingGuide && options.writingGuideFile) {
            throw new Error("pass either --writing-guide or --writing-guide-file, not both");
          }
          const body: Record<string, unknown> = {
            company_profile_id: toInt(options.profileId, "profile id"),
            keyword: options.keyword,
            page_type: wirePageType(options.pageType),
            cta_label: options.ctaLabel,
          };
          if (options.ctaUrl) body.cta_url = options.ctaUrl;
          if (options.secondaryKeywords) {
            const keywords = splitCsv(options.secondaryKeywords);
            if (keywords.length > 2) {
              throw new Error(`secondary keywords max out at 2, got ${keywords.length}`);
            }
            body.secondary_keywords = keywords;
          }
          const intent = {
            who: options.intentWho,
            want: options.intentWant,
            achieve: options.intentAchieve,
          };
          const intentValues = Object.values(intent);
          if (intentValues.some((value) => value)) {
            if (!intentValues.every((value) => value)) {
              throw new Error("pass all three of --intent-who, --intent-want, --intent-achieve or none");
            }
            body.intent = intent;
          }
          if (options.brandFacts) body.brand_facts = options.brandFacts;
          const guide = options.writingGuideFile
            ? await readTextFile(options.writingGuideFile)
            : options.writingGuide;
          if (guide) body.writing_guide = guide;
          if (options.imageUrls) body.image_urls = splitCsv(options.imageUrls);
          body.generate_images = options.images;
          if (options.allowedTerms) body.allowed_terms = splitCsv(options.allowedTerms);
          if (options.goldenUrl) body.golden_url = options.goldenUrl;
          const res = await client().post<{ landing_page_id: number }>("landing-pages/", body);
          billed(1);
          note(
            `Generation is asynchronous and spends real money (LLM, SERP). Poll with \`ve-dynamite landing-pages get ${res.landing_page_id}\``,
          );
          json(res);
        },
      ),
    );
  landingPages
    .command("get <landing-page-id>")
    .description("Show one landing page (slim {landing_page_id, status} shape until it completes)")
    .action(run(async (lpId: string) => json(await client().get(`landing-pages/${lpId}`))));
  landingPages
    .command("list")
    .description("List landing pages, newest first")
    .option("--page <n>", "Page number", "1")
    .option("--limit <n>", "Page size (max 100)", "10")
    .option("--company <name>", "Filter by exact company name")
    .option("--status <status>", "Filter by status: pending, success, failed")
    .action(
      run(async (options: { page: string; limit: string; company?: string; status?: string }) => {
        json(
          await client().get("landing-pages/", {
            page: toInt(options.page, "page"),
            limit: toInt(options.limit, "limit"),
            company_name: options.company,
            status: wireLandingStatus(options.status),
          }),
        );
      }),
    );
  landingPages
    .command("update <landing-page-id>")
    .description("Update copy fields and re-render the HTML in place (409 while still generating)")
    .option("--slug <slug>", "New slug")
    .option("--title-tag <title>", "New title tag")
    .option("--meta-description <text>", "New meta description")
    .option("--h1 <h1>", "New H1")
    .option("--cta-label <label>", "New CTA label")
    .option("--cta-url <url>", "New CTA URL")
    .option("--copy-file <path>", "Replace the copy deck from a JSON file (the shape returned by export --copy)")
    .action(
      run(
        async (
          lpId: string,
          options: {
            slug?: string;
            titleTag?: string;
            metaDescription?: string;
            h1?: string;
            ctaLabel?: string;
            ctaUrl?: string;
            copyFile?: string;
          },
        ) => {
          const payload: Record<string, unknown> = {};
          if (options.slug) payload.slug = options.slug;
          if (options.titleTag) payload.title_tag = options.titleTag;
          if (options.metaDescription) payload.meta_description = options.metaDescription;
          if (options.h1) payload.h1 = options.h1;
          if (options.ctaLabel) payload.cta_label = options.ctaLabel;
          if (options.ctaUrl) payload.cta_url = options.ctaUrl;
          if (options.copyFile) payload.copy_payload = JSON.parse(await readTextFile(options.copyFile));
          if (Object.keys(payload).length === 0) {
            throw new Error(
              "nothing to update, pass at least one of --slug, --title-tag, --meta-description, --h1, --cta-label, --cta-url, --copy-file",
            );
          }
          json(await client().put(`landing-pages/${lpId}`, payload));
        },
      ),
    );
  landingPages
    .command("fix-images")
    .description(
      "Find completed pages whose images fail the CDN gate and queue real image regeneration for each (spends real money per page)",
    )
    .option("--dry-run", "Only list the pages with placeholder or non CDN images, queue nothing")
    .action(
      run(async (options: { dryRun?: boolean }) => {
        const c = client();
        const audit = await c.get<{ landing_pages?: AuditItem[] }>("landing-pages/image-audit", { limit: 100 });
        const failing = audit.landing_pages ?? [];
        if (failing.length === 0) {
          note("All completed landing pages pass the image gate. Nothing to fix.");
          json(audit);
          return;
        }
        note(`${failing.length} landing page(s) contain placeholder or non CDN images:`);
        for (const item of failing) {
          note(
            `  #${item.landing_page_id} [${item.company_name}] ${item.keyword} (${item.image_failures.length} failure(s))`,
          );
        }
        if (options.dryRun) {
          json(audit);
          return;
        }
        const queued: unknown[] = [];
        for (const item of failing) {
          queued.push(await c.post(`landing-pages/${item.landing_page_id}/regenerate-images`));
          note(`queued image regeneration for #${item.landing_page_id}`);
        }
        billed(queued.length);
        note("Regeneration runs in the background, re-run `ve-dynamite landing-pages fix-images --dry-run` to check progress");
        json({ queued });
      }),
    );
  landingPages
    .command("delete <landing-page-id>")
    .description("Delete a landing page permanently")
    .option("--yes", "Confirm the deletion")
    .action(
      run(async (lpId: string, options: { yes?: boolean }) => {
        if (!options.yes) {
          throw new Error("deleting a landing page is permanent, re-run with --yes to confirm");
        }
        json(await client().delete(`landing-pages/${lpId}`));
      }),
    );
  landingPages
    .command("export <landing-page-id>")
    .description("Export a completed landing page as HTML or as its JSON copy deck")
    .option(
      "--html",
      "Export the rendered standalone HTML with CDN image URLs (refused while the page still has placeholder images)",
    )
    .option("--copy", "Export the structured copy deck as JSON")
    .option("--allow-placeholders", "Export even when the page still contains placeholder or non CDN images")
    .option("--inline", "Inline every image as a base64 data URI for a fully self contained file")
    .option("-o, --output <path>", "Write to a file instead of stdout")
    .action(
      run(
        async (
          lpId: string,
          options: { html?: boolean; copy?: boolean; allowPlaceholders?: boolean; inline?: boolean; output?: string },
        ) => {
          if (Boolean(options.html) === Boolean(options.copy)) {
            throw new Error("pass exactly one of --html or --copy");
          }
          const c = client();
          let text: string;
          if (options.html) {
            text = await c.getText(`landing-pages/${lpId}/export`, {
              format: "html",
              allow_placeholders: options.allowPlaceholders ? "true" : undefined,
              inline: options.inline ? "true" : undefined,
            });
          } else {
            const page = await c.get<{ status?: string; copy_payload?: unknown }>(`landing-pages/${lpId}`);
            if (page.status !== "success") {
              throw new Error(`landing page ${lpId} is still ${page.status}, nothing to export yet`);
            }
            text = JSON.stringify(page.copy_payload, null, 2);
          }
          if (options.output) {
            await writeTextFile(options.output, text);
            note(`exported landing page ${lpId} to ${options.output}`);
          } else {
            process.stdout.write(text.endsWith("\n") ? text : text + "\n");
          }
        },
      ),
    );

  const images = program.command("images").description("Manage featured image edit jobs");
  images
    .command("edit <article-id>")
    .description("Start a featured image edit job (async, costs real money)")
    .requiredOption("--image-url <url>", "URL of the image to edit")
    .requiredOption("--instruction <text>", "Edit instruction")
    .action(
      run(async (articleId: string, options: { imageUrl: string; instruction: string }) => {
        const res = await client().post<{ job_id: string }>(
          `content-writing/article/${articleId}/edit-feat-image`,
          { image_url: options.imageUrl, instruction: options.instruction },
        );
        billed(1);
        note(
          `Edit job submitted (costs real money). Poll with \`ve-dynamite images status ${articleId} ${res.job_id}\`, the job expires after 1h`,
        );
        json(res);
      }),
    );
  images
    .command("status <article-id> <job-id>")
    .description("Check an edit job (the server forgets a job after its first terminal read, save this output)")
    .action(
      run(async (articleId: string, jobId: string) => {
        const job = await client().get<{ status?: string }>(
          `content-writing/article/${articleId}/edit-feat-image/status/${jobId}`,
        );
        if (job.status && job.status !== "pending") {
          note("this was the only read for this job, the server has now forgotten it, save this output");
        }
        json(job);
      }),
    );
  images
    .command("commit <article-id>")
    .description("Persist an edited image as the article's featured image (arbitrary URLs go through `articles update --feat-image`)")
    .requiredOption("--image-url <url>", "Image URL from a done edit job in the last 24h")
    .action(
      run(async (articleId: string, options: { imageUrl: string }) => {
        json(
          await client().post(`content-writing/article/${articleId}/commit-feat-image`, {
            image_url: options.imageUrl,
          }),
        );
      }),
    );

  program
    .command("upload <file>")
    .description("Upload a file to the CDN")
    .requiredOption("--type <type>", "File type: image or csv")
    .action(
      run(async (file: string, options: { type: string }) => {
        if (!FILE_TYPES.includes(options.type)) {
          throw new Error(`invalid type '${options.type}', valid values: image, csv`);
        }
        const name = basename(file);
        if (!name.includes(".")) {
          throw new Error("file needs an extension, the CDN key is derived from it");
        }
        const bytes = await readBinaryFile(file);
        json(await client().postForm("upload/", name, bytes, null, { file_type: options.type }));
      }),
    );

  return program;
}

interface AuditItem {
  landing_page_id: number;
  company_name: string;
  keyword: string;
  image_failures: unknown[];
}

interface ProfileRecord {
  id: number;
  icp: string;
  [key: string]: unknown;
}

async function findProfile(client: ContentDynamiteClient, profileId: string): Promise<ProfileRecord> {
  const profiles = await client.get<ProfileRecord[]>("company-profile/");
  const id = toInt(profileId, "profile id");
  const profile = profiles.find((entry) => entry.id === id);
  if (!profile) {
    throw new Error(`profile ${profileId} not found, run \`ve-dynamite profiles list\``);
  }
  return profile;
}

interface BatchRecord {
  batch_id: number;
  [key: string]: unknown;
}

async function findBatch(client: ContentDynamiteClient, batchId: string): Promise<BatchRecord> {
  const batches = await client.get<BatchRecord[]>("content-writing/batches");
  const id = toInt(batchId, "batch id");
  const batch = batches.find((entry) => entry.batch_id === id);
  if (!batch) {
    throw new Error(`batch ${batchId} not found, run \`ve-dynamite batches list\``);
  }
  return batch;
}

async function pageArticles(client: ContentDynamiteClient, batchId: string): Promise<unknown[]> {
  const articles: unknown[] = [];
  let page = 1;
  for (;;) {
    const res = await client.get<{ articles: unknown[]; total_pages: number }>("content-writing/articles", {
      page,
      limit: 100,
      batch_id: batchId,
    });
    articles.push(...res.articles);
    if (page >= res.total_pages || res.articles.length === 0) break;
    page += 1;
  }
  return articles;
}

function parseIcp(icp: unknown): Record<string, unknown> | null {
  if (typeof icp !== "string") return null;
  let sections: unknown;
  try {
    sections = JSON.parse(icp);
  } catch {
    return null;
  }
  if (!sections || typeof sections !== "object" || Array.isArray(sections)) return null;
  const parsed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(sections as Record<string, unknown>)) {
    if (typeof value === "string") {
      try {
        parsed[key] = JSON.parse(value);
      } catch {
        parsed[key] = value;
      }
    } else {
      parsed[key] = value;
    }
  }
  return parsed;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const base64 = parts[1].replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const decoded = JSON.parse(atob(padded));
    return decoded && typeof decoded === "object" ? (decoded as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//i, "");
}

function basename(path: string): string {
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1] || path;
}

function toInt(value: string, label: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function fail(error: unknown): never {
  if (error instanceof ContentDynamiteApiError) {
    process.stderr.write(
      JSON.stringify({
        error: error.message,
        status: error.status,
        kind: error.kind,
        ...(error.hint ? { hint: error.hint } : {}),
      }) + "\n",
    );
  } else {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(JSON.stringify({ error: message }) + "\n");
  }
  process.exit(1);
}
