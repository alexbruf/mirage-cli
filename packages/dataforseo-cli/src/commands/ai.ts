import {
  command,
  CommandSpec,
  group,
  Option,
  OperandKind,
  type CommandDef,
} from "../framework/index.ts";
import {
  applyOutput,
  flagNum,
  flagStr,
  LOC_LANG_OPTIONS,
  OUTPUT_OPTIONS,
  resolveLocLang,
  textOp,
} from "../framework/output.ts";
import {
  aiAsk,
  aiMentionMetrics,
  aiMentions,
  aiSearchVolume,
  aiTopDomains,
  aiTopPages,
  type AiModel,
} from "../api/ai.ts";

const RESOURCE = "ram";

export const aiSearchVolumeCmd: CommandDef = command({
  name: "search-volume",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "AI-tool search volume — how often a keyword is typed at LLMs.",
    positional: [textOp("keywords", { variadic: true })],
    options: [...LOC_LANG_OPTIONS, ...OUTPUT_OPTIONS],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await aiSearchVolume({ ...resolveLocLang(opts), keywords: [...texts] });
    return applyOutput(resp, opts);
  },
});

export const aiMentionsCmd: CommandDef = command({
  name: "mentions",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Search LLM mentions for one or more keyword targets.",
    positional: [textOp("keywords", { variadic: true })],
    options: [...LOC_LANG_OPTIONS, ...OUTPUT_OPTIONS],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await aiMentions({ ...resolveLocLang(opts), keywords: [...texts] });
    return applyOutput(resp, opts);
  },
});

export const aiTopPagesCmd: CommandDef = command({
  name: "top-pages",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Top pages cited by AI for the given keyword targets.",
    positional: [textOp("keywords", { variadic: true })],
    options: [...LOC_LANG_OPTIONS, ...OUTPUT_OPTIONS],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await aiTopPages({ ...resolveLocLang(opts), keywords: [...texts] });
    return applyOutput(resp, opts);
  },
});

export const aiTopDomainsCmd: CommandDef = command({
  name: "top-domains",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Top domains cited by AI for the given keyword targets.",
    positional: [textOp("keywords", { variadic: true })],
    options: [...LOC_LANG_OPTIONS, ...OUTPUT_OPTIONS],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await aiTopDomains({ ...resolveLocLang(opts), keywords: [...texts] });
    return applyOutput(resp, opts);
  },
});

export const aiMetricsCmd: CommandDef = command({
  name: "metrics",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Aggregated LLM mention metrics (volume, sentiment) for keyword targets.",
    positional: [textOp("keywords", { variadic: true })],
    options: [...LOC_LANG_OPTIONS, ...OUTPUT_OPTIONS],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await aiMentionMetrics({ ...resolveLocLang(opts), keywords: [...texts] });
    return applyOutput(resp, opts);
  },
});

export const aiAskCmd: CommandDef = command({
  name: "ask",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Ask a specific LLM via DataForSEO's metered proxy.",
    positional: [textOp("message")],
    options: [
      new Option({
        long: "model",
        valueKind: OperandKind.TEXT,
        description: "chatgpt | claude | gemini | perplexity.",
        defaultValue: "chatgpt",
      }),
      new Option({
        long: "system",
        valueKind: OperandKind.TEXT,
        description: "Optional system message.",
      }),
      new Option({
        long: "max-tokens",
        valueKind: OperandKind.TEXT,
        description: "Max output tokens (default 512).",
        defaultValue: "512",
      }),
      new Option({
        long: "temperature",
        valueKind: OperandKind.TEXT,
        description: "Sampling temperature (default 0.3).",
        defaultValue: "0.3",
      }),
      ...OUTPUT_OPTIONS,
    ],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const model = flagStr(opts, "model", "chatgpt") as AiModel;
    const systemMessage = flagStr(opts, "system") || undefined;
    const resp = await aiAsk({
      model,
      message: texts[0] ?? "",
      systemMessage,
      maxOutputTokens: flagNum(opts, "max-tokens", 512),
      temperature: Number(flagStr(opts, "temperature", "0.3")),
    });
    return applyOutput(resp, opts);
  },
});

export const aiGroup = group({
  name: "ai",
  description: "AI Optimization: LLM mentions, top pages/domains, AI search volume, LLM proxy.",
  commands: [aiSearchVolumeCmd, aiMentionsCmd, aiTopPagesCmd, aiTopDomainsCmd, aiMetricsCmd, aiAskCmd],
});
