import {
  command,
  CommandSpec,
  Option,
  OperandKind,
  type CommandDef,
} from "../framework/index.ts";
import { applyOutput, flagStr, OUTPUT_OPTIONS } from "../framework/output.ts";
import { listLanguages, listLocations, userData } from "../api/meta.ts";

const RESOURCE = "ram";

export const locationsCmd: CommandDef = command({
  name: "locations",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "List supported locations for a given API.",
    options: [
      new Option({
        long: "api",
        valueKind: OperandKind.TEXT,
        description: "API path under /v3.",
        defaultValue: "serp/google",
      }),
      ...OUTPUT_OPTIONS,
    ],
  }),
  fn: async (_acc, _paths, _texts, opts) => {
    const resp = await listLocations(flagStr(opts, "api", "serp/google"));
    return applyOutput(resp, opts);
  },
});

export const languagesCmd: CommandDef = command({
  name: "languages",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "List supported languages for a given API.",
    options: [
      new Option({
        long: "api",
        valueKind: OperandKind.TEXT,
        description: "API path under /v3.",
        defaultValue: "serp/google",
      }),
      ...OUTPUT_OPTIONS,
    ],
  }),
  fn: async (_acc, _paths, _texts, opts) => {
    const resp = await listLanguages(flagStr(opts, "api", "serp/google"));
    return applyOutput(resp, opts);
  },
});

export const userCmd: CommandDef = command({
  name: "user",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Show DataForSEO account info (balance, plan, limits).",
    options: [...OUTPUT_OPTIONS],
  }),
  fn: async (_acc, _paths, _texts, opts) => {
    const resp = await userData();
    // Force --full: account info is most useful as the entire payload.
    return applyOutput(resp, { ...opts, flags: { ...opts.flags, full: true } });
  },
});
