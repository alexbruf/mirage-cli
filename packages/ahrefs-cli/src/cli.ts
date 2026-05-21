#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { accountGroup } from "./commands/account.ts";
import { batchAnalysisCmd } from "./commands/batch-analysis.ts";
import { gscGroup } from "./commands/gsc.ts";
import { keywordsGroup } from "./commands/keywords.ts";
import { rankTrackerGroup } from "./commands/rank-tracker.ts";
import { siteAuditGroup } from "./commands/site-audit.ts";
import { siteExplorerGroup } from "./commands/site-explorer.ts";
import { mountGroup, toCommander } from "./framework/runtime.ts";

/**
 * Build the ahrefs Commander program. Pure function — no side effects, safe
 * to call from in-process wrappers (`@mirage-cli/ahrefs`) or from this file's
 * own auto-parse block below when invoked as a CLI binary.
 */
export function buildProgram(): Command {
  const program = new Command()
    .name("ahrefs")
    .description("A simple CLI for the Ahrefs API v3. Maps cleanly to the web UI.")
    .version("0.1.0");

  mountGroup(program, siteExplorerGroup);
  mountGroup(program, keywordsGroup);
  mountGroup(program, rankTrackerGroup);
  mountGroup(program, siteAuditGroup);
  program.addCommand(toCommander(batchAnalysisCmd));
  mountGroup(program, gscGroup);
  mountGroup(program, accountGroup);

  return program;
}
