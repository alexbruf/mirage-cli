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
  flagStr,
  LOC_LANG_OPTIONS,
  OUTPUT_OPTIONS,
  resolveLocLang,
  textOp,
} from "../framework/output.ts";
import { trendsDemography, trendsExplore, trendsSubregion, type TrendsType } from "../api/trends.ts";

const RESOURCE = "ram";

export const trendsExploreCmd: CommandDef = command({
  name: "explore",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Google Trends 'Explore' — popularity time series for keywords.",
    positional: [textOp("keywords", { variadic: true })],
    options: [
      ...LOC_LANG_OPTIONS,
      new Option({
        long: "type",
        valueKind: OperandKind.TEXT,
        description: "web | news | youtube | images | shopping.",
        defaultValue: "web",
      }),
      new Option({
        long: "date-from",
        valueKind: OperandKind.TEXT,
        description: "Start date (YYYY-MM-DD).",
      }),
      new Option({
        long: "date-to",
        valueKind: OperandKind.TEXT,
        description: "End date (YYYY-MM-DD).",
      }),
      ...OUTPUT_OPTIONS,
    ],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await trendsExplore({
      ...resolveLocLang(opts),
      keywords: [...texts],
      type: flagStr(opts, "type", "web") as TrendsType,
      dateFrom: flagStr(opts, "date-from") || undefined,
      dateTo: flagStr(opts, "date-to") || undefined,
    });
    return applyOutput(resp, opts);
  },
});

export const trendsDemographyCmd: CommandDef = command({
  name: "demography",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Age/gender demographics for keyword interest (DataForSEO Trends).",
    positional: [textOp("keywords", { variadic: true })],
    options: [...LOC_LANG_OPTIONS, ...OUTPUT_OPTIONS],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await trendsDemography({ ...resolveLocLang(opts), keywords: [...texts] });
    return applyOutput(resp, opts);
  },
});

export const trendsSubregionCmd: CommandDef = command({
  name: "subregion",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Regional popularity heatmap for keywords (DataForSEO Trends).",
    positional: [textOp("keywords", { variadic: true })],
    options: [...LOC_LANG_OPTIONS, ...OUTPUT_OPTIONS],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await trendsSubregion({ ...resolveLocLang(opts), keywords: [...texts] });
    return applyOutput(resp, opts);
  },
});

export const trendsGroup = group({
  name: "trends",
  description: "Google Trends + DataForSEO Trends (time series, demography, region).",
  commands: [trendsExploreCmd, trendsDemographyCmd, trendsSubregionCmd],
});
