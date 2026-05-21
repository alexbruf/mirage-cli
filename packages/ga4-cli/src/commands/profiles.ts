import { Command } from "commander";
import fs from "node:fs";
import {
  getDefaultCredentialsPath,
  getProfilesDir,
  listProfiles,
} from "../auth.ts";
import { run } from "../utils.ts";

export function registerProfilesCommands(program: Command): void {
  program
    .command("profiles")
    .description("List local credentials profiles")
    .action(async (_opts, cmd: Command) => {
      const format = cmd.optsWithGlobals().format;
      await run(async () => {
        const defaultPath = getDefaultCredentialsPath();
        return {
          profilesDir: getProfilesDir(),
          profiles: listProfiles(),
          default: {
            path: defaultPath,
            exists: fs.existsSync(defaultPath),
          },
        };
      }, format);
    });
}
