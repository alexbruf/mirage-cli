import { Command } from "commander";
import { loadFileConfig, saveFileConfig } from "../shared/config.ts";
import { error, success } from "../format.ts";

export const configCommand = new Command("config")
  .description("Get or set CLI configuration")
  .argument("[key]", "Config key (e.g. server_url)")
  .argument("[value]", "Value to set")
  .action(async (key?: string, value?: string) => {
    try {
      const config = loadFileConfig();

      if (!key) {
        // Show all config
        if (Object.keys(config).length === 0) {
          console.log("No configuration set. Use: sms config server_url <url>");
          return;
        }
        for (const [k, v] of Object.entries(config)) {
          console.log(`${k} = ${v}`);
        }
        return;
      }

      if (key !== "server_url") {
        error(`Unknown config key: ${key}. Available keys: server_url`);
        process.exit(1);
      }

      if (!value) {
        // Get single key
        if (config.server_url) {
          console.log(config.server_url);
        } else {
          console.log("(not set)");
        }
        return;
      }

      // Set value
      config.server_url = value;
      saveFileConfig(config);
      success(`server_url = ${value}`);
    } catch (e: unknown) {
      error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });
