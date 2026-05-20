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
  flagBool,
  flagNum,
  LOC_LANG_OPTIONS,
  OUTPUT_OPTIONS,
  resolveLocLang,
  textOp,
  type LocLangResolved,
} from "../framework/output.ts";
import {
  keywordsIdeas,
  keywordsRanked,
  keywordsSearchVolume,
  keywordsSuggestions,
} from "../api/keywords.ts";

const RESOURCE = "ram";

function locLang(opts: { flags: Record<string, string | boolean> }): LocLangResolved {
  return resolveLocLang(opts);
}

export const keywordsSearchVolumeCmd: CommandDef = command({
  name: "search-volume",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Get monthly search volume / CPC / competition for keywords.",
    positional: [textOp("keywords", { variadic: true })],
    options: [
      ...LOC_LANG_OPTIONS,
      new Option({
        long: "include-serp-info",
        valueKind: OperandKind.NONE,
        description: "Also return SERP feature snapshot.",
      }),
      ...OUTPUT_OPTIONS,
    ],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await keywordsSearchVolume({
      ...locLang(opts),
      keywords: [...texts],
      includeSerpInfo: flagBool(opts, "include-serp-info"),
    });
    return applyOutput(resp, opts);
  },
});

export const keywordsIdeasCmd: CommandDef = command({
  name: "ideas",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Get keyword ideas (DataForSEO Labs).",
    positional: [textOp("keywords", { variadic: true })],
    options: [
      ...LOC_LANG_OPTIONS,
      new Option({ long: "limit", valueKind: OperandKind.TEXT, description: "Max results.", defaultValue: "100" }),
      ...OUTPUT_OPTIONS,
    ],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await keywordsIdeas({
      ...locLang(opts),
      keywords: [...texts],
      limit: flagNum(opts, "limit", 100),
    });
    return applyOutput(resp, opts);
  },
});

export const keywordsSuggestionsCmd: CommandDef = command({
  name: "suggestions",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Get keyword suggestions for a seed keyword.",
    positional: [textOp("keyword")],
    options: [
      ...LOC_LANG_OPTIONS,
      new Option({ long: "limit", valueKind: OperandKind.TEXT, description: "Max results.", defaultValue: "100" }),
      ...OUTPUT_OPTIONS,
    ],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await keywordsSuggestions({
      ...locLang(opts),
      keyword: texts[0] ?? "",
      limit: flagNum(opts, "limit", 100),
    });
    return applyOutput(resp, opts);
  },
});

export const keywordsRankedCmd: CommandDef = command({
  name: "ranked",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Keywords a target domain or URL ranks for.",
    positional: [textOp("target")],
    options: [
      ...LOC_LANG_OPTIONS,
      new Option({ long: "limit", valueKind: OperandKind.TEXT, description: "Max results.", defaultValue: "100" }),
      ...OUTPUT_OPTIONS,
    ],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await keywordsRanked({
      ...locLang(opts),
      target: texts[0] ?? "",
      limit: flagNum(opts, "limit", 100),
    });
    return applyOutput(resp, opts);
  },
});

export const keywordsGroup = group({
  name: "keywords",
  description: "Search volume, ideas, suggestions.",
  commands: [keywordsSearchVolumeCmd, keywordsIdeasCmd, keywordsSuggestionsCmd, keywordsRankedCmd],
});
