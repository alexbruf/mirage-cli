import type { Command } from "commander";
import { TimingClient } from "../client.ts";
import { output, outputMessage, outputError } from "../output.ts";
import { formatRunning, formatEntry } from "../format.ts";
import type { GlobalOptions } from "../types.ts";

function getOpts(cmd: Command): GlobalOptions {
  return cmd.optsWithGlobals() as GlobalOptions;
}

export function registerTimerCommands(program: Command) {
  program
    .command("start")
    .description("Start a timer")
    .option("--project <ref>", "Project self reference or ID")
    .option("--title <title>", "Timer title")
    .option("--notes <notes>", "Timer notes")
    .option("--billing <status>", "Billing status")
    .action(async (opts, cmd) => {
      const globals = getOpts(cmd);
      const client = new TimingClient(globals.timezone);
      try {
        const projectRef = opts.project
          ? opts.project.startsWith("/api/") ? opts.project : `/api/v1/projects/${opts.project}`
          : undefined;
        const res = await client.startTimer({
          project: projectRef,
          title: opts.title,
          notes: opts.notes,
          billingStatus: opts.billing,
        });
        output(res.data, globals.format, () => formatEntry(res.data));
      } catch (e: any) {
        outputError(e.message, globals.format);
      }
    });

  program
    .command("stop")
    .description("Stop the running timer")
    .action(async (_opts, cmd) => {
      const globals = getOpts(cmd);
      const client = new TimingClient(globals.timezone);
      try {
        const res = await client.stopTimer();
        output(res.data, globals.format, () => formatEntry(res.data));
      } catch (e: any) {
        outputError(e.message, globals.format);
      }
    });

  program
    .command("running")
    .description("Show the currently running timer")
    .action(async (_opts, cmd) => {
      const globals = getOpts(cmd);
      const client = new TimingClient(globals.timezone);
      try {
        const res = await client.getRunning();
        output(res.data, globals.format, () => formatRunning(res.data));
      } catch (e: any) {
        if (e.message.includes("404")) {
          outputMessage("No timer is currently running.", globals.format);
        } else {
          outputError(e.message, globals.format);
        }
      }
    });

  program
    .command("latest")
    .description("Show the latest time entry")
    .action(async (_opts, cmd) => {
      const globals = getOpts(cmd);
      const client = new TimingClient(globals.timezone);
      try {
        const res = await client.getLatest();
        output(res.data, globals.format, () => formatEntry(res.data));
      } catch (e: any) {
        outputError(e.message, globals.format);
      }
    });
}
