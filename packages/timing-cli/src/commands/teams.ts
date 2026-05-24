import { Command } from "commander";
import { TimingClient } from "../client.ts";
import { output, outputError } from "../output.ts";
import { formatTeams, formatTeamMembers } from "../format.ts";
import type { GlobalOptions } from "../types.ts";

function getOpts(cmd: Command): GlobalOptions {
  return cmd.optsWithGlobals() as GlobalOptions;
}

export function registerTeamsCommand(program: Command) {
  const teams = program
    .command("teams")
    .description("Manage teams");

  teams
    .command("list")
    .description("List teams")
    .action(async (_opts, cmd) => {
      const globals = getOpts(cmd);
      const client = new TimingClient(globals.timezone);
      try {
        const res = await client.listTeams();
        output(res.data, globals.format, () => formatTeams(res.data));
      } catch (e: any) {
        outputError(e.message, globals.format);
      }
    });

  teams
    .command("members <teamId>")
    .description("List team members")
    .action(async (teamId, _opts, cmd) => {
      const globals = getOpts(cmd);
      const client = new TimingClient(globals.timezone);
      try {
        const res = await client.getTeamMembers(teamId);
        output(res.data, globals.format, () => formatTeamMembers(res.data));
      } catch (e: any) {
        outputError(e.message, globals.format);
      }
    });
}
