import { call, type DfsResponse } from "../lib/client.ts";
import type { LocLang } from "./keywords.ts";

function locLangPayload(loc: LocLang): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (loc.locationCode !== undefined) body.location_code = loc.locationCode;
  else body.location_name = loc.locationName ?? "United States";
  if (loc.languageCode !== undefined) body.language_code = loc.languageCode;
  else body.language_name = loc.languageName ?? "English";
  return body;
}

export type AiModel = "chatgpt" | "claude" | "gemini" | "perplexity";

const MODEL_PATH: Record<AiModel, string> = {
  chatgpt: "ai_optimization/chat_gpt/llm_responses/live",
  claude: "ai_optimization/claude/llm_responses/live",
  gemini: "ai_optimization/gemini/llm_responses/live",
  perplexity: "ai_optimization/perplexity/llm_responses/live",
};

/** AI-flavored search volume — how often a keyword is typed at AI tools. */
export async function aiSearchVolume(opts: LocLang & { keywords: string[] }): Promise<DfsResponse> {
  return call("ai_optimization/ai_keyword_data/keywords_search_volume/live", {
    ...locLangPayload(opts),
    keywords: opts.keywords,
  });
}

/** Find LLM mentions matching one or more keyword targets. */
export async function aiMentions(opts: LocLang & { keywords: string[] }): Promise<DfsResponse> {
  return call("ai_optimization/llm_mentions/search/live", {
    ...locLangPayload(opts),
    target: opts.keywords.map((k) => ({ keyword: k })),
  });
}

/** Top pages cited by AI for the given keyword targets. */
export async function aiTopPages(opts: LocLang & { keywords: string[] }): Promise<DfsResponse> {
  return call("ai_optimization/llm_mentions/top_pages/live", {
    ...locLangPayload(opts),
    target: opts.keywords.map((k) => ({ keyword: k })),
  });
}

/** Top domains cited by AI for the given keyword targets. */
export async function aiTopDomains(opts: LocLang & { keywords: string[] }): Promise<DfsResponse> {
  return call("ai_optimization/llm_mentions/top_domains/live", {
    ...locLangPayload(opts),
    target: opts.keywords.map((k) => ({ keyword: k })),
  });
}

/** Aggregated mention metrics (volume, sentiment, etc.) for keyword targets. */
export async function aiMentionMetrics(opts: LocLang & { keywords: string[] }): Promise<DfsResponse> {
  return call("ai_optimization/llm_mentions/aggregated_metrics/live", {
    ...locLangPayload(opts),
    target: opts.keywords.map((k) => ({ keyword: k })),
  });
}

/** Ask a specific LLM via DataForSEO's metered LLM proxy. */
export async function aiAsk(opts: {
  model: AiModel;
  message: string;
  systemMessage?: string;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
}): Promise<DfsResponse> {
  return call(MODEL_PATH[opts.model], {
    system_message: opts.systemMessage,
    message_chain: [{ role: "user", message: opts.message }],
    max_output_tokens: opts.maxOutputTokens ?? 512,
    temperature: opts.temperature ?? 0.3,
    top_p: opts.topP ?? 0.5,
  });
}
