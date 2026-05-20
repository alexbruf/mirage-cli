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
  LOC_LANG_OPTIONS,
  OUTPUT_OPTIONS,
  resolveLocLang,
  textOp,
} from "../framework/output.ts";
import {
  labsBulkDifficulty,
  labsCompetitors,
  labsHistorical,
  labsIntent,
  labsIntersection,
  labsKeywordOverview,
  labsOverview,
  labsRelated,
  labsTopSearches,
} from "../api/labs.ts";
import { flagBool } from "../framework/output.ts";

const RESOURCE = "ram";

const LIMIT = new Option({
  long: "limit",
  valueKind: OperandKind.TEXT,
  description: "Max results.",
  defaultValue: "100",
});

export const labsCompetitorsCmd: CommandDef = command({
  name: "competitors",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Domains competing with the target on organic search.",
    positional: [textOp("target")],
    options: [...LOC_LANG_OPTIONS, LIMIT, ...OUTPUT_OPTIONS],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await labsCompetitors({
      ...resolveLocLang(opts),
      target: texts[0] ?? "",
      limit: flagNum(opts, "limit", 100),
    });
    return applyOutput(resp, opts);
  },
});

export const labsIntersectionCmd: CommandDef = command({
  name: "intersection",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Keyword overlap between two domains.",
    positional: [textOp("target1"), textOp("target2")],
    options: [...LOC_LANG_OPTIONS, LIMIT, ...OUTPUT_OPTIONS],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await labsIntersection({
      ...resolveLocLang(opts),
      target1: texts[0] ?? "",
      target2: texts[1] ?? "",
      limit: flagNum(opts, "limit", 100),
    });
    return applyOutput(resp, opts);
  },
});

export const labsOverviewCmd: CommandDef = command({
  name: "overview",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Domain rank overview (organic + paid traffic estimates).",
    positional: [textOp("target")],
    options: [...LOC_LANG_OPTIONS, ...OUTPUT_OPTIONS],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await labsOverview({
      ...resolveLocLang(opts),
      target: texts[0] ?? "",
    });
    return applyOutput(resp, opts);
  },
});

export const labsRelatedCmd: CommandDef = command({
  name: "related",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Semantically related keywords.",
    positional: [textOp("keyword")],
    options: [...LOC_LANG_OPTIONS, LIMIT, ...OUTPUT_OPTIONS],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await labsRelated({
      ...resolveLocLang(opts),
      keyword: texts[0] ?? "",
      limit: flagNum(opts, "limit", 100),
    });
    return applyOutput(resp, opts);
  },
});

export const labsKeywordOverviewCmd: CommandDef = command({
  name: "keyword-overview",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Full keyword profile: KD + volume + intent + SERP + backlinks for keywords.",
    positional: [textOp("keywords", { variadic: true })],
    options: [
      ...LOC_LANG_OPTIONS,
      new Option({ long: "include-serp-info", valueKind: OperandKind.NONE, description: "Include SERP feature snapshot." }),
      new Option({ long: "include-clickstream", valueKind: OperandKind.NONE, description: "Include clickstream-derived volume." }),
      ...OUTPUT_OPTIONS,
    ],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await labsKeywordOverview({
      ...resolveLocLang(opts),
      keywords: [...texts],
      includeSerpInfo: flagBool(opts, "include-serp-info"),
      includeClickstream: flagBool(opts, "include-clickstream"),
    });
    return applyOutput(resp, opts);
  },
});

export const labsBulkDifficultyCmd: CommandDef = command({
  name: "bulk-difficulty",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Bulk keyword difficulty (KD) for up to 1000 keywords in one call.",
    positional: [textOp("keywords", { variadic: true })],
    options: [...LOC_LANG_OPTIONS, ...OUTPUT_OPTIONS],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await labsBulkDifficulty({ ...resolveLocLang(opts), keywords: [...texts] });
    return applyOutput(resp, opts);
  },
});

export const labsIntentCmd: CommandDef = command({
  name: "intent",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Classify search intent (informational/navigational/commercial/transactional) for keywords.",
    positional: [textOp("keywords", { variadic: true })],
    options: [...LOC_LANG_OPTIONS, ...OUTPUT_OPTIONS],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await labsIntent({ ...resolveLocLang(opts), keywords: [...texts] });
    return applyOutput(resp, opts);
  },
});

export const labsTopSearchesCmd: CommandDef = command({
  name: "top-searches",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Currently-trending top searches in a location.",
    options: [...LOC_LANG_OPTIONS, LIMIT, ...OUTPUT_OPTIONS],
  }),
  fn: async (_acc, _paths, _texts, opts) => {
    const resp = await labsTopSearches({ ...resolveLocLang(opts), limit: flagNum(opts, "limit", 100) });
    return applyOutput(resp, opts);
  },
});

export const labsHistoricalCmd: CommandDef = command({
  name: "historical",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Historical rank overview for a domain (month-by-month position counts).",
    positional: [textOp("target")],
    options: [...LOC_LANG_OPTIONS, ...OUTPUT_OPTIONS],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await labsHistorical({ ...resolveLocLang(opts), target: texts[0] ?? "" });
    return applyOutput(resp, opts);
  },
});

export const labsGroup = group({
  name: "labs",
  description: "DataForSEO Labs: competitors, gap analysis, keyword overview, intent, historical.",
  commands: [
    labsCompetitorsCmd,
    labsIntersectionCmd,
    labsOverviewCmd,
    labsRelatedCmd,
    labsKeywordOverviewCmd,
    labsBulkDifficultyCmd,
    labsIntentCmd,
    labsTopSearchesCmd,
    labsHistoricalCmd,
  ],
});
