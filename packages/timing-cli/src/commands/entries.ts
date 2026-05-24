import { Command } from "commander";
import { TimingClient } from "../client.ts";
import { output, outputMessage, outputError } from "../output.ts";
import { formatEntries, formatEntry } from "../format.ts";
import type { GlobalOptions } from "../types.ts";

function getOpts(cmd: Command): GlobalOptions {
  return cmd.optsWithGlobals() as GlobalOptions;
}

export function registerEntriesCommand(program: Command) {
  const entries = program
    .command("entries")
    .description("Manage time entries");

  entries
    .command("list")
    .description("List time entries")
    .option("--from <date>", "Start date (YYYY-MM-DD or ISO8601)")
    .option("--to <date>", "End date (YYYY-MM-DD or ISO8601)")
    .option("--project <ref...>", "Filter by project(s)")
    .option("--include-children", "Include child project entries")
    .option("--search <query>", "Search query")
    .option("--billing <status...>", "Filter by billing status")
    .option("--all-pages", "Fetch all pages")
    .action(async (opts, cmd) => {
      const globals = getOpts(cmd);
      const client = new TimingClient(globals.timezone);
      try {
        const res = await client.listEntries({
          startDateMin: opts.from,
          startDateMax: opts.to,
          projects: opts.project,
          includeChildProjects: opts.includeChildren,
          searchQuery: opts.search,
          billingStatus: opts.billing,
          allPages: opts.allPages,
        });
        output(res.data, globals.format, () => formatEntries(res.data));
      } catch (e: any) {
        outputError(e.message, globals.format);
      }
    });

  entries
    .command("get <id>")
    .description("Get a specific time entry")
    .action(async (id, _opts, cmd) => {
      const globals = getOpts(cmd);
      const client = new TimingClient(globals.timezone);
      try {
        const res = await client.getEntry(id);
        output(res.data, globals.format, () => formatEntry(res.data));
      } catch (e: any) {
        outputError(e.message, globals.format);
      }
    });

  entries
    .command("create")
    .description("Create a time entry")
    .requiredOption("--start <date>", "Start date (ISO8601)")
    .requiredOption("--end <date>", "End date (ISO8601)")
    .option("--project <ref>", "Project reference")
    .option("--title <title>", "Entry title")
    .option("--notes <notes>", "Entry notes")
    .option("--billing <status>", "Billing status")
    .option("--billing-rate <rate>", "Billing rate", parseFloat)
    .option("--replace-existing", "Replace overlapping entries")
    .action(async (opts, cmd) => {
      const globals = getOpts(cmd);
      const client = new TimingClient(globals.timezone);
      try {
        const projectRef = opts.project
          ? opts.project.startsWith("/api/") ? opts.project : `/api/v1/projects/${opts.project}`
          : undefined;
        const res = await client.createEntry({
          startDate: opts.start,
          endDate: opts.end,
          project: projectRef,
          title: opts.title,
          notes: opts.notes,
          billingStatus: opts.billing,
          billingRate: opts.billingRate,
          replaceExisting: opts.replaceExisting,
        });
        output(res.data, globals.format, () => formatEntry(res.data));
      } catch (e: any) {
        outputError(e.message, globals.format);
      }
    });

  entries
    .command("update <id>")
    .description("Update a time entry")
    .option("--start <date>", "Start date")
    .option("--end <date>", "End date")
    .option("--project <ref>", "Project reference")
    .option("--title <title>", "Entry title")
    .option("--notes <notes>", "Entry notes")
    .option("--billing <status>", "Billing status")
    .option("--billing-rate <rate>", "Billing rate", parseFloat)
    .action(async (id, opts, cmd) => {
      const globals = getOpts(cmd);
      const client = new TimingClient(globals.timezone);
      try {
        const res = await client.updateEntry(id, {
          startDate: opts.start,
          endDate: opts.end,
          project: opts.project,
          title: opts.title,
          notes: opts.notes,
          billingStatus: opts.billing,
          billingRate: opts.billingRate,
        });
        output(res.data, globals.format, () => formatEntry(res.data));
      } catch (e: any) {
        outputError(e.message, globals.format);
      }
    });

  entries
    .command("delete <id>")
    .description("Delete a time entry")
    .action(async (id, _opts, cmd) => {
      const globals = getOpts(cmd);
      const client = new TimingClient(globals.timezone);
      try {
        await client.deleteEntry(id);
        outputMessage(`Entry ${id} deleted.`, globals.format);
      } catch (e: any) {
        outputError(e.message, globals.format);
      }
    });

  entries
    .command("batch-update")
    .description("Batch update multiple time entries")
    .requiredOption("--ids <ids...>", "Time entry IDs to update")
    .option("--project <ref>", "Project reference")
    .option("--title <title>", "Entry title")
    .option("--notes <notes>", "Entry notes")
    .option("--billing <status>", "Billing status")
    .action(async (opts, cmd) => {
      const globals = getOpts(cmd);
      const client = new TimingClient(globals.timezone);
      try {
        await client.batchUpdateEntries({
          entryIds: opts.ids,
          project: opts.project,
          title: opts.title,
          notes: opts.notes,
          billingStatus: opts.billing,
        });
        outputMessage(`${opts.ids.length} entries updated.`, globals.format);
      } catch (e: any) {
        outputError(e.message, globals.format);
      }
    });
}
