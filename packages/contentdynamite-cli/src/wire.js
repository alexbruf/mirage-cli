// src/database/models.ts
var USER_ROLES = ["admin", "normal"];
var ARTICLE_STATUSES = ["pending", "success", "failed"];
var ARTICLE_TYPES = ["listicle"];
var INTERACTIVE_TYPES = ["quiz", "game", "calculator", "chart"];
var GBP_POST_STATUSES = ["pending", "done", "failed"];
var GBP_IMAGE_MODES = ["none", "supplied", "article", "generate"];
var GBP_POST_SOURCES = ["article", "topic"];
var LANDING_DELIVERABLES = ["copy", "page"];
var LANDING_PAGE_STATUSES = ["pending", "success", "failed"];
var REVISION_PARTS = ["intro", "section", "image", "feat_image", "faq", "video", "interactive"];
var REVISION_STATUSES = ["pending", "ready", "failed"];
var REVISION_VERDICTS = ["better", "same", "worse"];
var REVISION_TARGETS = ["section", "heading", "passage", "question", "answer"];
var ICP_SECTIONS = [
  "business_overview",
  "customer_profile",
  "channel_analysis",
  "pain_points",
  "intent_funnel",
  "competitive_landscape"
];
// src/utils/py-regex.ts
var WORD = "\\p{L}\\p{N}_";
var PY_SPACE = "\\t\\n\\v\\f\\r\\u001c-\\u001f \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
var BOUNDARY = `(?:(?<=[${WORD}])(?![${WORD}])|(?<![${WORD}])(?=[${WORD}]))`;
var NOT_BOUNDARY = `(?:(?<=[${WORD}])(?=[${WORD}])|(?<![${WORD}])(?![${WORD}]))`;
var SYNTAX = new Set(["^", "$", "\\", ".", "*", "+", "?", "(", ")", "[", "]", "{", "}", "|", "/"]);
var PY_SPACE_RUN_RE = new RegExp(`[${PY_SPACE}]+`, "u");
var PY_STRIP_RE = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, "g");
var pyStrip = (text) => text.replace(PY_STRIP_RE, "");
var PY_SPACE_RUNS_RE = new RegExp(`[${PY_SPACE}]+`, "gu");

// src/features/landing-page/landing-page.wire.ts
function wireLandingStatus(status) {
  if (status === null || status === undefined)
    return;
  let value = status.toLowerCase();
  if (value === "sucess")
    value = "success";
  if (!LANDING_PAGE_STATUSES.includes(value))
    throw new Error(`invalid status '${status}', valid values: ${LANDING_PAGE_STATUSES.join(", ")}`);
  return value;
}
function wireDeliverable(deliverable) {
  const value = pyStrip(deliverable.toLowerCase());
  if (!LANDING_DELIVERABLES.includes(value))
    throw new Error(`invalid deliverable '${deliverable}', valid values: ${LANDING_DELIVERABLES.join(", ")}`);
  return value;
}
// src/features/mcp/mcp.wire.ts
import { z as z4 } from "zod";

// src/features/content/content.dto.ts
import { z as z2 } from "zod";

// src/utils/interactive-embed.ts
var TAG_BY_TYPE = {
  quiz: "cg-quiz",
  game: "cg-game",
  calculator: "cg-calculator",
  chart: "cg-chart"
};
var EMBED_RE = new RegExp(String.raw`[ \t]*(?:<script\s+src="[^"]*"\s+defer\s*>\s*</script>\s*)?<(${Object.values(TAG_BY_TYPE).join("|")})\b[^>]*>[\s\S]*?</\1>[ \t]*`, "gi");

// src/utils/generic.dto.ts
import { z } from "zod";
var exportQuery = z.object({ format: z.enum(["docx", "md"]).default("docx") });
var PYTHON_TRUTHY = ["1", "on", "t", "true", "y", "yes"];
var PYTHON_FALSY = ["0", "off", "f", "false", "n", "no"];
var queryBool = z.stringbool({ truthy: PYTHON_TRUTHY, falsy: PYTHON_FALSY, error: "Input should be a valid boolean, unable to interpret input" });

// src/utils/validate.ts
function valueErrors(checks) {
  return (_, context) => {
    const failure = checks().find(([failed]) => failed);
    if (failure)
      context.addIssue({ code: "custom", message: `Value error, ${failure[1]}` });
  };
}
var blank = (value) => value != null && !value.trim();

// src/features/content/content.dto.ts
var optionalText = z2.string().nullable().optional();
var CLEARABLE_FIELDS = ["intro", "body", "faqs", "feat_image"];
var articleParam = z2.object({ article_id: z2.coerce.number().int() });
var batchParam = z2.object({ batch_id: z2.coerce.number().int() });
var articlesQuery = z2.object({
  page: z2.coerce.number().int().min(1).default(1),
  limit: z2.coerce.number().int().min(1).max(100).default(10),
  company_name: z2.string().optional(),
  status: z2.enum(ARTICLE_STATUSES).optional(),
  batch_id: z2.coerce.number().int().optional()
});
var listicleResearchQuery = z2.object({
  profile_id: z2.coerce.number().int(),
  keyword: z2.string(),
  title: z2.string().optional(),
  location: z2.string().optional(),
  item_count: z2.coerce.number().int().optional()
});
var updateArticleDto = z2.object({
  title: optionalText,
  slug: optionalText,
  intro: optionalText,
  body: optionalText,
  faqs: optionalText,
  feat_image: optionalText
}).superRefine((dto, context) => valueErrors(() => [
  [dto.title === null || blank(dto.title), "title must not be empty if provided"],
  [dto.slug === null || blank(dto.slug), "slug must not be empty if provided"],
  ...CLEARABLE_FIELDS.map((field) => [blank(dto[field]), `${field} must not be empty if provided`])
])(dto, context));
var optionalList = z2.array(z2.string()).nullable().default(null);
var articleJobItem = z2.object({
  company_profile_id: z2.number().int(),
  search_query: z2.string(),
  primary_keywords: z2.string(),
  secondary_keywords: z2.string().nullable().default(null),
  location_to_rank_for: z2.string().nullable().default(null),
  extra_guidelines: z2.string().nullable().default(null),
  image_guideline: z2.string().nullable().default(null),
  internal_links: optionalList,
  external_links: optionalList,
  competitor_links: optionalList,
  infographic_feat_image: z2.boolean().default(false),
  generate_video: z2.boolean().default(false),
  generate_interactive: z2.boolean().default(false),
  interactive_type: z2.enum(INTERACTIVE_TYPES).nullable().default(null),
  gbp_post: z2.boolean().default(false),
  dewatermark: z2.boolean().nullable().default(null),
  article_type: z2.enum(ARTICLE_TYPES).nullable().default(null),
  listicle_research: z2.string().nullable().default(null),
  item_count: z2.number().int().nullable().default(null),
  brand_facts: z2.string().nullable().default(null),
  allowed_competitors: optionalList,
  table_sources: z2.record(z2.string(), z2.string()).nullable().default(null)
});
var cleanList = (values) => values.filter((value) => value && value.trim()).map((value) => value.trim());
var isHttpUrl = (url) => /^https?:\/\//.test(url.toLowerCase());
var blankToNull = (value) => value !== null && !value.trim() ? null : value;
function cleanTableSources(sources) {
  const pairs = [];
  const seen = new Map;
  for (const [rawName, rawUrl] of Object.entries(sources)) {
    const name = (rawName ?? "").trim();
    const url = (rawUrl ?? "").trim();
    if (!name || !url)
      return `table_sources: '${name || url}' needs both an option name and a URL`;
    if (!isHttpUrl(url))
      return `table_sources: '${url}' is not an http(s) URL`;
    const key = name.toLowerCase();
    if (seen.has(key))
      return `table_sources: '${name}' and '${seen.get(key)}' name the same option`;
    seen.set(key, name);
    pairs.push([name, url]);
  }
  if (pairs.length > 10)
    return "table_sources: maximum 10 entries allowed";
  return pairs.length > 0 ? Object.fromEntries(pairs) : null;
}
function normaliseJobItem(item) {
  const out = { ...item, extra_guidelines: blankToNull(item.extra_guidelines), image_guideline: blankToNull(item.image_guideline) };
  if (out.internal_links !== null) {
    const cleaned = cleanList(out.internal_links);
    out.internal_links = cleaned.length > 0 ? cleaned : null;
  }
  if (out.external_links !== null) {
    const cleaned = cleanList(out.external_links);
    if (cleaned.length > 5)
      return "external_links: maximum 5 URLs allowed";
    const invalid = cleaned.find((url) => !isHttpUrl(url));
    if (invalid !== undefined)
      return `external_links: '${invalid}' is not an http(s) URL`;
    out.external_links = cleaned.length > 0 ? cleaned : null;
  }
  if (out.competitor_links !== null) {
    const cleaned = cleanList(out.competitor_links);
    if (cleaned.length > 3)
      return "competitor_links: maximum 3 URLs allowed";
    out.competitor_links = cleaned.length > 0 ? cleaned : null;
  }
  out.listicle_research = blankToNull(out.listicle_research);
  if (out.article_type === "listicle" && !out.listicle_research)
    return "listicle_research is required when article_type is 'listicle'";
  if (out.item_count !== null && !(out.item_count >= 3 && out.item_count <= 10))
    return "item_count must be between 3 and 10";
  out.brand_facts = blankToNull(out.brand_facts);
  if (out.allowed_competitors !== null) {
    const cleaned = cleanList(out.allowed_competitors);
    if (cleaned.length > 12)
      return "allowed_competitors: maximum 12 names allowed";
    out.allowed_competitors = cleaned.length > 0 ? cleaned : null;
  }
  if (out.table_sources !== null) {
    const sources = cleanTableSources(out.table_sources);
    if (typeof sources === "string")
      return sources;
    out.table_sources = sources;
  }
  return out;
}
var articleDto = articleJobItem.transform((item, context) => {
  const normalised = normaliseJobItem(item);
  if (typeof normalised !== "string")
    return normalised;
  context.addIssue({ code: "custom", message: `Value error, ${normalised}` });
  return z2.NEVER;
});
var batchWriteQuery = z2.object({
  batch_name: z2.string(),
  extra_guidelines: z2.string().optional(),
  image_guideline: z2.string().optional(),
  infographic_feat_image: queryBool.default(false),
  generate_video: queryBool.default(false),
  generate_interactive: queryBool.default(false),
  interactive_type: z2.enum(INTERACTIVE_TYPES).optional(),
  gbp_post: queryBool.default(false),
  dewatermark: queryBool.optional(),
  article_type: z2.enum(ARTICLE_TYPES).optional()
});
var batchFileForm = z2.object({ file: z2.file() });
var editFeatImageDto = z2.object({ image_url: z2.string(), instruction: z2.string() }).superRefine((dto, context) => valueErrors(() => [
  [!dto.image_url.trim(), "image_url must not be empty"],
  [!dto.instruction.trim(), "instruction must not be empty"]
])(dto, context));
var commitFeatImageDto = z2.object({ image_url: z2.string() }).superRefine((dto, context) => valueErrors(() => [[!dto.image_url.trim(), "image_url must not be empty"]])(dto, context));
var editJobParam = z2.object({ article_id: z2.coerce.number().int(), job_id: z2.string() });
var exportToDocsQuery = z2.object({ replace: queryBool.default(false) });
var auditPage = {
  page: z2.coerce.number().int().min(1).default(1),
  limit: z2.coerce.number().int().min(1).max(200).default(50)
};
var auditQuery = z2.object(auditPage);
var qaAuditQuery = z2.object({ ...auditPage, company_name: z2.string().optional(), images: queryBool.default(true) });
var articleQaQuery = z2.object({ model_checks: queryBool.default(false), store: queryBool.default(true) });
var cleanProvenanceQuery = z2.object({ rewrite: queryBool.default(false) });
var stripEmbedsBody = z2.array(z2.number().int()).nullable();

// src/features/gbp-post/gbp-post.dto.ts
import { z as z3 } from "zod";
var optionalText2 = z3.string().nullable().default(null);
var gbpPostJobItem = z3.object({
  company_profile_id: z3.number().int(),
  topic: optionalText2,
  article_id: z3.number().int().nullable().default(null),
  location: optionalText2,
  facts: optionalText2,
  guidelines: optionalText2,
  image_mode: z3.enum(GBP_IMAGE_MODES).nullable().default(null),
  image_url: optionalText2,
  image_guideline: optionalText2,
  regenerate: z3.boolean().default(false)
});
var TEXT_FIELDS = ["topic", "location", "facts", "guidelines", "image_url", "image_guideline"];
var isHttpUrl2 = (url) => /^https?:\/\//.test(url.toLowerCase());
function normaliseGbpJob(item) {
  const out = { ...item };
  for (const field of TEXT_FIELDS) {
    const value = out[field];
    if (value !== null)
      out[field] = value.trim() || null;
  }
  if (!out.topic && out.article_id === null)
    return "a post needs either a topic or an article_id to repurpose";
  const mode = out.image_mode ?? (out.image_url ? "supplied" : out.article_id !== null ? "article" : "generate");
  if (mode === "supplied" && !out.image_url)
    return "image_mode 'supplied' needs an image_url";
  if (mode === "article" && out.article_id === null)
    return "image_mode 'article' needs an article_id to take the image from";
  if (out.image_url && !isHttpUrl2(out.image_url))
    return `image_url: '${out.image_url}' is not an http(s) URL`;
  if (out.image_guideline && mode !== "generate")
    return "image_guideline only applies when image_mode is 'generate'";
  return { ...out, image_mode: mode };
}
var gbpPostDto = gbpPostJobItem.transform((item, context) => {
  const normalised = normaliseGbpJob(item);
  if (typeof normalised !== "string")
    return normalised;
  context.addIssue({ code: "custom", message: `Value error, ${normalised}` });
  return z3.NEVER;
});
var updateGbpPostDto = z3.object({
  content: z3.string().nullable().optional(),
  image_url: z3.string().nullable().optional(),
  topic: z3.string().nullable().optional(),
  status: z3.enum(GBP_POST_STATUSES).nullable().optional()
}).transform((dto, context) => {
  if (dto.content != null && !dto.content.trim())
    context.addIssue({ code: "custom", message: "Value error, content must not be empty if provided" });
  else if (dto.topic != null && !dto.topic.trim())
    context.addIssue({ code: "custom", message: "Value error, topic must not be empty if provided" });
  else if (dto.image_url != null && dto.image_url.trim() && !isHttpUrl2(dto.image_url.trim())) {
    context.addIssue({ code: "custom", message: `Value error, image_url: '${dto.image_url.trim()}' is not an http(s) URL` });
  } else {
    const out = {};
    if (dto.content != null)
      out.content = dto.content;
    if (dto.status != null)
      out.status = dto.status;
    if (dto.topic !== undefined)
      out.topic = dto.topic;
    if (dto.image_url !== undefined)
      out.image_url = dto.image_url?.trim() || null;
    return out;
  }
  return z3.NEVER;
});
var gbpPostParam = z3.object({ post_id: z3.coerce.number().int() });
var gbpPostsQuery = z3.object({
  page: z3.coerce.number().int().min(1).default(1),
  limit: z3.coerce.number().int().min(1).max(100).default(10),
  company_name: z3.string().optional(),
  status: z3.enum(GBP_POST_STATUSES).optional(),
  source: z3.enum(GBP_POST_SOURCES).optional()
});
var legacyGbpPostsQuery = gbpPostsQuery.pick({ page: true, limit: true, status: true });
var batchGbpQuery = z3.object({
  location: z3.string().optional(),
  facts: z3.string().optional(),
  guidelines: z3.string().optional(),
  image_mode: z3.enum(GBP_IMAGE_MODES).optional(),
  image_guideline: z3.string().optional()
});
var imageOptionsQuery = z3.object({ company_profile_id: z3.coerce.number().int() });

// src/features/mcp/mcp.wire.ts
var STATUS_ALIASES = { pending: "pending", success: "success", sucess: "success", failed: "failed" };
var BATCH_WIDE_ONLY_FIELDS = ["extra_guidelines", "image_guideline"];
function withoutDefaults(shape) {
  return Object.fromEntries(Object.entries(shape).map(([key, field]) => [key, field instanceof z4.ZodDefault ? field.unwrap().optional() : field]));
}
var batchArticleJob = z4.object(withoutDefaults(articleJobItem.shape));
var batchGbpJob = z4.object(withoutDefaults(gbpPostJobItem.shape));
function wireStatus(status) {
  if (status == null)
    return;
  const mapped = STATUS_ALIASES[status.toLowerCase()];
  if (!mapped)
    throw new Error(`invalid status '${status}', valid values: ${ARTICLE_STATUSES.join(", ")}`);
  return mapped;
}
function wireGbpStatus(status) {
  if (status == null)
    return;
  const value = status.toLowerCase() === "success" ? "done" : status.toLowerCase();
  if (!GBP_POST_STATUSES.includes(value))
    throw new Error(`invalid status '${status}', valid values: ${GBP_POST_STATUSES.join(", ")}`);
  return value;
}
function wireGbpSource(source) {
  if (source == null)
    return;
  const value = source.toLowerCase();
  if (!GBP_POST_SOURCES.includes(value))
    throw new Error(`invalid source '${source}', valid values: ${GBP_POST_SOURCES.join(", ")}`);
  return value;
}
function cell(value) {
  if (value == null)
    return "";
  if (Array.isArray(value))
    return value.join("|");
  if (typeof value === "boolean")
    return value ? "true" : "false";
  if (typeof value === "object")
    return Object.entries(value).map(([name, url]) => `${name}=${url}`).join("|");
  return String(value);
}
function quote(value) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
function toCsv(jobs, required, optional) {
  const columns = [...required, ...optional.filter((field) => jobs.some((job) => job[field] != null))];
  const lines = [columns, ...jobs.map((job) => columns.map((column) => cell(job[column])))];
  return lines.map((line) => line.map(quote).join(",") + `
`).join("");
}
var ARTICLE_REQUIRED = ["company_profile_id", "search_query", "primary_keywords"];
var GBP_REQUIRED = ["company_profile_id"];
function articleJobsToCsv(jobs, guidelineHint) {
  jobs.forEach((job, index) => {
    if (BATCH_WIDE_ONLY_FIELDS.some((field) => job[field]))
      throw new Error(`job ${index}: per job guidelines are not supported by the API, use ${guidelineHint}`);
  });
  const optional = Object.keys(articleJobItem.shape).filter((field) => !ARTICLE_REQUIRED.includes(field) && !BATCH_WIDE_ONLY_FIELDS.includes(field));
  return new File([toCsv(jobs, ARTICLE_REQUIRED, optional)], "jobs.csv", { type: "text/csv" });
}
function gbpJobsToCsv(jobs) {
  const optional = Object.keys(gbpPostJobItem.shape).filter((field) => !GBP_REQUIRED.includes(field));
  return new File([toCsv(jobs, GBP_REQUIRED, optional)], "posts.csv", { type: "text/csv" });
}
// src/utils/csv.ts
var EOL = null;
function parseCsv(text) {
  const records = [];
  let fields = [];
  let field = "";
  let state = "start_record";
  const saveField = () => {
    fields.push(field);
    field = "";
  };
  const endRecord = () => {
    records.push(fields);
    fields = [];
    state = "start_record";
  };
  const endOfLine = (character) => {
    saveField();
    state = character === EOL ? "start_record" : "eat_crnl";
  };
  const process = (character) => {
    switch (state) {
      case "eat_crnl":
        if (character === `
` || character === "\r")
          return;
        if (character === EOL) {
          state = "start_record";
          return;
        }
        endRecord();
        process(character);
        return;
      case "start_record":
        if (character === EOL)
          return;
        if (character === `
` || character === "\r") {
          state = "eat_crnl";
          return;
        }
        state = "start_field";
        process(character);
        return;
      case "start_field":
        if (character === `
` || character === "\r" || character === EOL)
          endOfLine(character);
        else if (character === '"')
          state = "in_quoted_field";
        else if (character === ",")
          saveField();
        else {
          field += character;
          state = "in_field";
        }
        return;
      case "in_field":
        if (character === `
` || character === "\r" || character === EOL)
          endOfLine(character);
        else if (character === ",") {
          saveField();
          state = "start_field";
        } else
          field += character;
        return;
      case "in_quoted_field":
        if (character === EOL)
          return;
        if (character === '"')
          state = "quote_in_quoted_field";
        else
          field += character;
        return;
      case "quote_in_quoted_field":
        if (character === '"') {
          field += character;
          state = "in_quoted_field";
        } else if (character === ",") {
          saveField();
          state = "start_field";
        } else if (character === `
` || character === "\r" || character === EOL)
          endOfLine(character);
        else {
          field += character;
          state = "in_field";
        }
        return;
    }
  };
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    for (const character of line)
      process(character);
    process(EOL);
    if (state === "start_record")
      endRecord();
  }
  if (field || state === "in_quoted_field") {
    saveField();
    endRecord();
  }
  return records;
}
function readCsvTable(text) {
  const [header, ...records] = parseCsv(text);
  if (header === undefined)
    return { fieldnames: null, rows: [] };
  const rows = records.filter((record) => record.length > 0).map((record) => {
    const row = new Map;
    header.forEach((name, index) => row.set(name, record[index] ?? ""));
    return row;
  });
  return { fieldnames: header, rows };
}
export {
  wireStatus,
  wireLandingStatus,
  wireGbpStatus,
  wireGbpSource,
  wireDeliverable,
  readCsvTable,
  gbpJobsToCsv,
  batchGbpJob,
  batchArticleJob,
  articleJobsToCsv,
  USER_ROLES,
  REVISION_VERDICTS,
  REVISION_TARGETS,
  REVISION_STATUSES,
  REVISION_PARTS,
  INTERACTIVE_TYPES,
  ICP_SECTIONS
};
