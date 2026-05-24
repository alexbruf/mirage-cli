import { Command } from "commander";
import { TimingClient } from "../client.ts";
import { output, outputError } from "../output.ts";
import { formatReport } from "../format.ts";
import type { GlobalOptions } from "../types.ts";

function getOpts(cmd: Command): GlobalOptions {
  return cmd.optsWithGlobals() as GlobalOptions;
}

export function registerReportCommand(program: Command) {
  program
    .command("report")
    .description("Generate a report")
    .requiredOption("--from <date>", "Start date (YYYY-MM-DD)")
    .requiredOption("--to <date>", "End date (YYYY-MM-DD)")
    .option("--columns <cols...>", "Columns to include")
    .option("--group-by <fields...>", "Group by fields")
    .option("--sort-by <field>", "Sort by field")
    .option("--sort-order <order>", "Sort order (asc|desc)")
    .option("--project <ref...>", "Filter by project(s)")
    .option("--include-children", "Include child project entries")
    .option("--search <query>", "Search query")
    .option("--billing <status...>", "Filter by billing status")
    .option("--team-members <refs...>", "Filter by team members")
    .option("--timespan <span>", "Timespan grouping (day|week|month)")
    .action(async (opts, cmd) => {
      const globals = getOpts(cmd);
      const client = new TimingClient(globals.timezone);
      try {
        const res = await client.getReport({
          startDateMin: opts.from,
          startDateMax: opts.to,
          columns: opts.columns,
          groupBy: opts.groupBy,
          sortBy: opts.sortBy,
          sortOrder: opts.sortOrder,
          projects: opts.project,
          includeChildProjects: opts.includeChildren,
          searchQuery: opts.search,
          billingStatus: opts.billing,
          teamMembers: opts.teamMembers,
          timespan: opts.timespan,
        });
        output(res.data, globals.format, () => formatReport(res.data));
      } catch (e: any) {
        outputError(e.message, globals.format);
      }
    });
}
