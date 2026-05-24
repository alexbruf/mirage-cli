/**
 * Timing CLI as a commander.js program factory. Idempotent, side-effect free
 * on import. The bin entry (`src/bin.ts`) calls `.parseAsync(process.argv)`.
 *
 * Wraps the Timing app API (web.timingapp.com). Auth via `TIMING_API_TOKEN`
 * env var, or interactively via `timing setup`.
 *
 * Read-only subcommands: `projects list/get`, `entries list/get`, `report`,
 * `teams list/get`, `activities …`. Mutating: `start`, `stop`, `entries
 * create/update/delete`, `projects create/update/delete`.
 */
import { Command } from "commander";
import { registerActivitiesCommand } from "./commands/activities.ts";
import { registerEntriesCommand } from "./commands/entries.ts";
import { registerProjectsCommand } from "./commands/projects.ts";
import { registerReportCommand } from "./commands/report.ts";
import { registerSetupCommand } from "./commands/setup.ts";
import { registerTeamsCommand } from "./commands/teams.ts";
import { registerTimerCommands } from "./commands/timer.ts";

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("timing")
    .description("CLI for the Timing app API")
    .version("0.1.6")
    .option("--format <format>", "Output format (json|table)", "json")
    .option("--timezone <tz>", "Timezone for date interpretation (e.g. America/New_York)");

  registerTimerCommands(program);
  registerProjectsCommand(program);
  registerEntriesCommand(program);
  registerReportCommand(program);
  registerTeamsCommand(program);
  registerActivitiesCommand(program);
  registerSetupCommand(program);

  return program;
}
