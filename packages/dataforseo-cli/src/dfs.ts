import { Command } from "commander";
import { mountGroup, toCommander } from "./framework/index.ts";
import { aiGroup } from "./commands/ai.ts";
import { backlinksGroup } from "./commands/backlinks.ts";
import { endpointsGroup } from "./commands/endpoints.ts";
import { keywordsGroup } from "./commands/keywords.ts";
import { labsGroup } from "./commands/labs.ts";
import { loginCmd, whoamiCmd } from "./commands/login.ts";
import { languagesCmd, locationsCmd, userCmd } from "./commands/meta.ts";
import { rawCmd } from "./commands/raw.ts";
import { serpGroup } from "./commands/serp.ts";
import { trendsGroup } from "./commands/trends.ts";

/**
 * Build the dfs Commander program. Pure function — no side effects, safe to
 * call from in-process wrappers (`@mirage-cli/dataforseo`) or from this file's
 * own auto-parse block below when invoked as a CLI binary.
 */
export function buildProgram(): Command {
  const program = new Command();
  program
    .name("dfs")
    .description(
      "Ergonomic CLI for the DataForSEO API.\n\n" +
        "Curated commands cover ~40 high-value endpoints.\n" +
        "Use `dfs raw <path>` to hit any of the 437 endpoints by path,\n" +
        "and `dfs endpoints list` / `dfs endpoints show` to discover them.",
    )
    .version("0.3.0");

  // Top-level single commands
  program.addCommand(toCommander(loginCmd));
  program.addCommand(toCommander(whoamiCmd));
  program.addCommand(toCommander(locationsCmd));
  program.addCommand(toCommander(languagesCmd));
  program.addCommand(toCommander(userCmd));
  program.addCommand(toCommander(rawCmd));

  // Grouped commands
  mountGroup(program, keywordsGroup);
  mountGroup(program, serpGroup);
  mountGroup(program, backlinksGroup);
  mountGroup(program, labsGroup);
  mountGroup(program, aiGroup);
  mountGroup(program, trendsGroup);
  mountGroup(program, endpointsGroup);

  return program;
}
