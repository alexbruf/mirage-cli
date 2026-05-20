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
  flagStr,
  LOC_LANG_OPTIONS,
  OUTPUT_OPTIONS,
  resolveLocLang,
  textOp,
} from "../framework/output.ts";
import {
  serpGoogleImages,
  serpGoogleMaps,
  serpGoogleNews,
  serpGoogleOrganic,
  serpYoutubeOrganic,
} from "../api/serp.ts";

const RESOURCE = "ram";

const COMMON_OPTIONS = [
  ...LOC_LANG_OPTIONS,
  new Option({ long: "device", valueKind: OperandKind.TEXT, description: "desktop | mobile.", defaultValue: "desktop" }),
  new Option({ long: "depth", valueKind: OperandKind.TEXT, description: "Result depth.", defaultValue: "100" }),
];

export const serpGoogleOrganicCmd: CommandDef = command({
  name: "organic",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Live Google organic SERP for a keyword.",
    positional: [textOp("keyword")],
    options: [
      ...COMMON_OPTIONS,
      new Option({
        long: "advanced",
        valueKind: OperandKind.NONE,
        description: "Use the advanced endpoint with featured snippet detail.",
      }),
      ...OUTPUT_OPTIONS,
    ],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await serpGoogleOrganic({
      ...resolveLocLang(opts),
      keyword: texts[0] ?? "",
      device: (flagStr(opts, "device", "desktop") as "desktop" | "mobile"),
      depth: flagNum(opts, "depth", 100),
      advanced: flagBool(opts, "advanced"),
    });
    return applyOutput(resp, opts);
  },
});

export const serpGoogleMapsCmd: CommandDef = command({
  name: "maps",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Google Maps / local pack results.",
    positional: [textOp("keyword")],
    options: [...COMMON_OPTIONS, ...OUTPUT_OPTIONS],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await serpGoogleMaps({
      ...resolveLocLang(opts),
      keyword: texts[0] ?? "",
      device: (flagStr(opts, "device", "desktop") as "desktop" | "mobile"),
      depth: flagNum(opts, "depth", 100),
    });
    return applyOutput(resp, opts);
  },
});

export const serpGoogleNewsCmd: CommandDef = command({
  name: "news",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Google News results for a keyword.",
    positional: [textOp("keyword")],
    options: [...COMMON_OPTIONS, ...OUTPUT_OPTIONS],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await serpGoogleNews({
      ...resolveLocLang(opts),
      keyword: texts[0] ?? "",
      device: (flagStr(opts, "device", "desktop") as "desktop" | "mobile"),
      depth: flagNum(opts, "depth", 100),
    });
    return applyOutput(resp, opts);
  },
});

export const serpGoogleImagesCmd: CommandDef = command({
  name: "images",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Google Images results for a keyword.",
    positional: [textOp("keyword")],
    options: [...COMMON_OPTIONS, ...OUTPUT_OPTIONS],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await serpGoogleImages({
      ...resolveLocLang(opts),
      keyword: texts[0] ?? "",
      device: (flagStr(opts, "device", "desktop") as "desktop" | "mobile"),
      depth: flagNum(opts, "depth", 100),
    });
    return applyOutput(resp, opts);
  },
});

export const serpYoutubeOrganicCmd: CommandDef = command({
  name: "organic",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "YouTube organic search results.",
    positional: [textOp("keyword")],
    options: [...COMMON_OPTIONS, ...OUTPUT_OPTIONS],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await serpYoutubeOrganic({
      ...resolveLocLang(opts),
      keyword: texts[0] ?? "",
      depth: flagNum(opts, "depth", 100),
    });
    return applyOutput(resp, opts);
  },
});

export const serpGroup = group({
  name: "serp",
  description: "SERP queries against Google / YouTube.",
  groups: [
    group({
      name: "google",
      description: "Google SERPs.",
      commands: [serpGoogleOrganicCmd, serpGoogleMapsCmd, serpGoogleNewsCmd, serpGoogleImagesCmd],
    }),
    group({
      name: "youtube",
      description: "YouTube SERPs.",
      commands: [serpYoutubeOrganicCmd],
    }),
  ],
});
