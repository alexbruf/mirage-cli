import {
  command,
  CommandSpec,
  group,
  Option,
  OperandKind,
  type CommandDef,
} from "../framework/index.ts";
import { applyOutput, flagNum, flagStr, OUTPUT_OPTIONS, textOp } from "../framework/output.ts";
import {
  backlinksAnchors,
  backlinksCompetitors,
  backlinksList,
  backlinksRanks,
  backlinksReferringDomains,
  backlinksSummary,
} from "../api/backlinks.ts";

const RESOURCE = "ram";

const LIMIT = new Option({
  long: "limit",
  valueKind: OperandKind.TEXT,
  description: "Max results.",
  defaultValue: "100",
});

export const backlinksSummaryCmd: CommandDef = command({
  name: "summary",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "High-level backlink summary for a target.",
    positional: [textOp("target")],
    options: [...OUTPUT_OPTIONS],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await backlinksSummary(texts[0] ?? "");
    return applyOutput(resp, opts);
  },
});

export const backlinksListCmd: CommandDef = command({
  name: "list",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "List individual backlinks.",
    positional: [textOp("target")],
    options: [
      LIMIT,
      new Option({
        long: "mode",
        valueKind: OperandKind.TEXT,
        description: "as_is | one_per_domain | one_per_anchor.",
        defaultValue: "as_is",
      }),
      ...OUTPUT_OPTIONS,
    ],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await backlinksList({
      target: texts[0] ?? "",
      limit: flagNum(opts, "limit", 100),
      mode: flagStr(opts, "mode", "as_is") as "as_is" | "one_per_domain" | "one_per_anchor",
    });
    return applyOutput(resp, opts);
  },
});

export const backlinksReferringDomainsCmd: CommandDef = command({
  name: "referring-domains",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Referring domains pointing to a target.",
    positional: [textOp("target")],
    options: [LIMIT, ...OUTPUT_OPTIONS],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await backlinksReferringDomains({
      target: texts[0] ?? "",
      limit: flagNum(opts, "limit", 100),
    });
    return applyOutput(resp, opts);
  },
});

export const backlinksAnchorsCmd: CommandDef = command({
  name: "anchors",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Anchor text distribution for a target.",
    positional: [textOp("target")],
    options: [LIMIT, ...OUTPUT_OPTIONS],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await backlinksAnchors({
      target: texts[0] ?? "",
      limit: flagNum(opts, "limit", 100),
    });
    return applyOutput(resp, opts);
  },
});

export const backlinksCompetitorsCmd: CommandDef = command({
  name: "competitors",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Domains with similar backlink profiles.",
    positional: [textOp("target")],
    options: [LIMIT, ...OUTPUT_OPTIONS],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await backlinksCompetitors({
      target: texts[0] ?? "",
      limit: flagNum(opts, "limit", 100),
    });
    return applyOutput(resp, opts);
  },
});

export const backlinksRanksCmd: CommandDef = command({
  name: "ranks",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Bulk DataForSEO domain rank for up to 1000 targets.",
    positional: [textOp("targets", { variadic: true })],
    options: [...OUTPUT_OPTIONS],
  }),
  fn: async (_acc, _paths, texts, opts) => {
    const resp = await backlinksRanks([...texts]);
    return applyOutput(resp, opts);
  },
});

export const backlinksGroup = group({
  name: "backlinks",
  description: "Backlink profiles, referring domains, anchors.",
  commands: [
    backlinksSummaryCmd,
    backlinksListCmd,
    backlinksReferringDomainsCmd,
    backlinksAnchorsCmd,
    backlinksCompetitorsCmd,
    backlinksRanksCmd,
  ],
});
