export const INTERACTIVE_TYPES = ["quiz", "game", "calculator"] as const;

export const LANDING_PAGE_TYPES = [
  "single_product",
  "multiple_products",
  "alternative",
  "blog_paste",
  "minimal",
] as const;

const ARTICLE_STATUS_ALIASES: Record<string, string> = {
  pending: "pending",
  success: "sucess",
  sucess: "sucess",
  failed: "failed",
};

const LANDING_STATUSES = ["pending", "success", "failed"];

export function wireArticleStatus(status: string | undefined): string | undefined {
  if (status === undefined) return undefined;
  const mapped = ARTICLE_STATUS_ALIASES[status.toLowerCase()];
  if (!mapped) {
    throw new Error(`invalid status '${status}', valid values: pending, success, failed`);
  }
  return mapped;
}

export function wireLandingStatus(status: string | undefined): string | undefined {
  if (status === undefined) return undefined;
  let value = status.toLowerCase();
  if (value === "sucess") value = "success";
  if (!LANDING_STATUSES.includes(value)) {
    throw new Error(`invalid status '${status}', valid values: ${LANDING_STATUSES.join(", ")}`);
  }
  return value;
}

export function wirePageType(pageType: string): string {
  const value = pageType.toLowerCase().replaceAll("-", "_");
  if (!(LANDING_PAGE_TYPES as readonly string[]).includes(value)) {
    throw new Error(`invalid page type '${pageType}', valid values: ${LANDING_PAGE_TYPES.join(", ")}`);
  }
  return value;
}

export function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function interactiveFields(value: string | boolean | undefined): Record<string, unknown> {
  if (value === undefined) return {};
  const fields: Record<string, unknown> = { generate_interactive: true };
  if (typeof value === "string" && value) {
    if (!(INTERACTIVE_TYPES as readonly string[]).includes(value)) {
      throw new Error(`invalid interactive type '${value}', valid values: ${INTERACTIVE_TYPES.join(", ")}`);
    }
    fields.interactive_type = value;
  }
  return fields;
}

export const REQUIRED_JOB_FIELDS = [
  "company_profile_id",
  "search_query",
  "primary_keywords",
] as const;

export const BATCH_WIDE_ONLY_FIELDS = ["extra_guidelines", "image_guideline"] as const;

export const OPTIONAL_JOB_FIELDS = [
  "secondary_keywords",
  "location_to_rank_for",
  "internal_links",
  "competitor_links",
  "infographic_feat_image",
  "generate_video",
  "generate_interactive",
  "interactive_type",
  "gbp_post",
] as const;

const JOB_FIELDS = new Set<string>([
  ...REQUIRED_JOB_FIELDS,
  ...BATCH_WIDE_ONLY_FIELDS,
  ...OPTIONAL_JOB_FIELDS,
]);

export const BATCH_GUIDELINE_HINT = "the batch wide --guidelines / --image-guideline flags";

export function jobsToCsv(raw: unknown): Uint8Array {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("--jobs file must be a non empty JSON array");
  }
  const jobs: Record<string, unknown>[] = [];
  raw.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`job ${index}: must be a JSON object`);
    }
    const record = item as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if ((BATCH_WIDE_ONLY_FIELDS as readonly string[]).includes(key)) {
        throw new Error(`job ${index}: per job guidelines are not supported by the API, use ${BATCH_GUIDELINE_HINT}`);
      }
      if (!JOB_FIELDS.has(key)) {
        throw new Error(`job ${index}: unknown field '${key}'`);
      }
    }
    for (const key of REQUIRED_JOB_FIELDS) {
      if (record[key] === undefined || record[key] === null || record[key] === "") {
        throw new Error(`job ${index}: ${key} is required`);
      }
    }
    jobs.push(record);
  });

  const columns: string[] = [
    ...REQUIRED_JOB_FIELDS,
    ...OPTIONAL_JOB_FIELDS.filter((field) =>
      jobs.some((job) => job[field] !== undefined && job[field] !== null),
    ),
  ];
  const lines = [columns.map(csvQuote).join(",")];
  for (const job of jobs) {
    lines.push(columns.map((column) => csvQuote(csvCell(job[column]))).join(","));
  }
  return new TextEncoder().encode(lines.join("\n") + "\n");
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join("|");
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function csvQuote(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
