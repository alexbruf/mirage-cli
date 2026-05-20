import {
  command,
  CommandSpec,
  group,
  IOResult,
  Option,
  OperandKind,
  type CommandDef,
} from "../framework/index.ts";
import { flagBool, flagStr, textOp } from "../framework/output.ts";
import { findEndpoint, loadEndpoints, searchEndpoints } from "../lib/spec.ts";

const RESOURCE = "ram";
const ENC = new TextEncoder();

export const endpointsListCmd: CommandDef = command({
  name: "list",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "List endpoints, optionally filtered by tag and/or query.",
    options: [
      new Option({ short: "t", long: "tag", valueKind: OperandKind.TEXT, description: "Filter by tag." }),
      new Option({ short: "q", long: "query", valueKind: OperandKind.TEXT, description: "Substring match." }),
      new Option({ long: "json", valueKind: OperandKind.NONE, description: "Emit JSON instead of lines." }),
    ],
  }),
  fn: async (_acc, _paths, _texts, opts) => {
    const tag = flagStr(opts, "tag") || undefined;
    const matches = searchEndpoints(flagStr(opts, "query", ""), tag);
    if (flagBool(opts, "json")) {
      return [ENC.encode(JSON.stringify(matches, null, 2) + "\n"), new IOResult()];
    }
    const lines = matches.map((ep) => `${ep.method.toUpperCase().padEnd(4)} ${ep.path}`).join("\n");
    return [ENC.encode(lines + "\n"), new IOResult({ stderr: `\n(${matches.length} endpoints)\n` })];
  },
});

export const endpointsShowCmd: CommandDef = command({
  name: "show",
  resource: RESOURCE,
  spec: new CommandSpec({
    description: "Show details for one endpoint.",
    positional: [textOp("path")],
  }),
  fn: async (_acc, _paths, texts) => {
    const target = texts[0] ?? "";
    const ep = findEndpoint(target);
    if (!ep) {
      return [null, new IOResult({ exitCode: 1, stderr: `No endpoint matches ${target}\n` })];
    }
    let out = `${ep.method.toUpperCase()} ${ep.path}\n`;
    if (ep.tag) out += `tag: ${ep.tag}\n`;
    if (ep.operationId) out += `operationId: ${ep.operationId}\n`;
    if (ep.docUrl) out += `docs: ${ep.docUrl}\n`;
    if (ep.description) out += `\n${ep.description}\n`;
    if (ep.example !== undefined) out += `\nexample body:\n${JSON.stringify(ep.example, null, 2)}\n`;
    return [ENC.encode(out), new IOResult()];
  },
});

export const endpointsTagsCmd: CommandDef = command({
  name: "tags",
  resource: RESOURCE,
  spec: new CommandSpec({ description: "List all tags and how many endpoints each has." }),
  fn: async () => {
    const counts = new Map<string, number>();
    for (const ep of loadEndpoints()) {
      const t = ep.tag ?? "(untagged)";
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const lines = sorted.map(([tag, n]) => `${String(n).padStart(4)}  ${tag}`).join("\n");
    return [ENC.encode(lines + "\n"), new IOResult()];
  },
});

export const endpointsGroup = group({
  name: "endpoints",
  description: "Discover and inspect DataForSEO endpoints.",
  commands: [endpointsListCmd, endpointsShowCmd, endpointsTagsCmd],
});
