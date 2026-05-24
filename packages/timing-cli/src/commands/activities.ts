import { Command } from "commander";
import { TimingClient } from "../client.ts";
import { outputError } from "../output.ts";
import type { GlobalOptions } from "../types.ts";

function getOpts(cmd: Command): GlobalOptions {
  return cmd.optsWithGlobals() as GlobalOptions;
}

export function registerActivitiesCommand(program: Command) {
  program
    .command("activities")
    .description("Show activity hierarchy (plain text)")
    .requiredOption("--start <date>", "Start date (ISO8601 or YYYY-MM-DD)")
    .requiredOption("--end <date>", "End date (ISO8601 or YYYY-MM-DD)")
    .option("--block-size <seconds>", "Block size in seconds", parseInt)
    .action(async (opts, cmd) => {
      const globals = getOpts(cmd);
      const client = new TimingClient(globals.timezone);
      try {
        const text = await client.getActivityHierarchy({
          startDate: opts.start,
          endDate: opts.end,
          blockSize: opts.blockSize,
        });
        // Activity hierarchy is always plain text
        console.log(text);
      } catch (e: any) {
        outputError(e.message, globals.format);
      }
    });
}
