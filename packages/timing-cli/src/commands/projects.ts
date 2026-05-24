import { Command } from "commander";
import { TimingClient } from "../client.ts";
import { output, outputMessage, outputError } from "../output.ts";
import { formatProjects, formatProject } from "../format.ts";
import type { GlobalOptions } from "../types.ts";

function getOpts(cmd: Command): GlobalOptions {
  return cmd.optsWithGlobals() as GlobalOptions;
}

export function registerProjectsCommand(program: Command) {
  const projects = program
    .command("projects")
    .description("Manage projects");

  projects
    .command("list")
    .description("List all projects")
    .option("--title <title>", "Filter by title")
    .option("--hide-archived", "Hide archived projects")
    .option("--team-id <id>", "Filter by team")
    .option("--all-pages", "Fetch all pages")
    .action(async (opts, cmd) => {
      const globals = getOpts(cmd);
      const client = new TimingClient(globals.timezone);
      try {
        const res = await client.listProjects({
          title: opts.title,
          hideArchived: opts.hideArchived,
          teamId: opts.teamId,
          allPages: opts.allPages,
        });
        output(res.data, globals.format, () => formatProjects(res.data));
      } catch (e: any) {
        outputError(e.message, globals.format);
      }
    });

  projects
    .command("hierarchy")
    .description("List projects as a hierarchy")
    .option("--hide-archived", "Hide archived projects")
    .option("--team-id <id>", "Filter by team")
    .action(async (opts, cmd) => {
      const globals = getOpts(cmd);
      const client = new TimingClient(globals.timezone);
      try {
        const res = await client.getProjectHierarchy({
          hideArchived: opts.hideArchived,
          teamId: opts.teamId,
        });
        output(res.data, globals.format, () => formatProjects(res.data));
      } catch (e: any) {
        outputError(e.message, globals.format);
      }
    });

  projects
    .command("get <id>")
    .description("Get a specific project")
    .action(async (id, _opts, cmd) => {
      const globals = getOpts(cmd);
      const client = new TimingClient(globals.timezone);
      try {
        const res = await client.getProject(id);
        output(res.data, globals.format, () => formatProject(res.data));
      } catch (e: any) {
        outputError(e.message, globals.format);
      }
    });

  projects
    .command("create")
    .description("Create a new project")
    .requiredOption("--title <title>", "Project title")
    .option("--color <color>", "Hex color (e.g. #FF0000)")
    .option("--parent <ref>", "Parent project reference")
    .option("--notes <notes>", "Project notes")
    .option("--billing-rate <rate>", "Default billing rate", parseFloat)
    .option("--billing-status <status>", "Default billing status")
    .option("--team-id <id>", "Team ID")
    .action(async (opts, cmd) => {
      const globals = getOpts(cmd);
      const client = new TimingClient(globals.timezone);
      try {
        const res = await client.createProject({
          title: opts.title,
          color: opts.color,
          parent: opts.parent,
          notes: opts.notes,
          defaultBillingRate: opts.billingRate,
          defaultBillingStatus: opts.billingStatus,
          teamId: opts.teamId,
        });
        output(res.data, globals.format, () => formatProject(res.data));
      } catch (e: any) {
        outputError(e.message, globals.format);
      }
    });

  projects
    .command("update <id>")
    .description("Update a project")
    .option("--title <title>", "Project title")
    .option("--color <color>", "Hex color")
    .option("--parent <ref>", "Parent project reference")
    .option("--notes <notes>", "Project notes")
    .option("--archived", "Archive the project")
    .option("--billing-rate <rate>", "Default billing rate", parseFloat)
    .option("--billing-status <status>", "Default billing status")
    .action(async (id, opts, cmd) => {
      const globals = getOpts(cmd);
      const client = new TimingClient(globals.timezone);
      try {
        const res = await client.updateProject(id, {
          title: opts.title,
          color: opts.color,
          parent: opts.parent,
          notes: opts.notes,
          isArchived: opts.archived,
          defaultBillingRate: opts.billingRate,
          defaultBillingStatus: opts.billingStatus,
        });
        output(res.data, globals.format, () => formatProject(res.data));
      } catch (e: any) {
        outputError(e.message, globals.format);
      }
    });

  projects
    .command("delete <id>")
    .description("Delete a project")
    .action(async (id, _opts, cmd) => {
      const globals = getOpts(cmd);
      const client = new TimingClient(globals.timezone);
      try {
        await client.deleteProject(id);
        outputMessage(`Project ${id} deleted.`, globals.format);
      } catch (e: any) {
        outputError(e.message, globals.format);
      }
    });
}
