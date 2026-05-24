import type { Command } from "commander";
import { saveConfig, getConfigPath } from "../config.ts";

export function registerSetupCommand(program: Command) {
  program
    .command("setup")
    .description("Save your Timing API token to ~/.config/timing-cli/config.json")
    .argument("<token>", "Your Timing API token")
    .action((token) => {
      saveConfig(token);
      console.log(`API token saved to ${getConfigPath()}`);
    });
}
