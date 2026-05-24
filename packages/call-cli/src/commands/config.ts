import { Command } from "commander";
import { loadFileConfig, saveFileConfig } from "../shared/config.ts";
import { success, info, error } from "../format.ts";

const VALID_KEYS = ["server_url", "elevenlabs_api_key", "api_key"] as const;

export const configCommand = new Command("config")
  .description("Get or set CLI configuration")
  .argument("[key]", "Config key (server_url, elevenlabs_api_key)")
  .argument("[value]", "Value to set")
  .action((key?: string, value?: string) => {
    const config = loadFileConfig();

    if (!key) {
      // Show all config
      info("Config (~/.config/call/config.json):");
      for (const k of VALID_KEYS) {
        const v = config[k];
        if (v) {
          const display = k.includes("key") ? v.slice(0, 8) + "..." : v;
          console.log(`  ${k}: ${display}`);
        }
      }
      if (!VALID_KEYS.some((k) => config[k])) {
        console.log("  (empty)");
      }
      return;
    }

    if (!VALID_KEYS.includes(key as (typeof VALID_KEYS)[number])) {
      error(`Unknown key: ${key}. Valid keys: ${VALID_KEYS.join(", ")}`);
      process.exit(1);
    }

    if (value === undefined) {
      // Get
      const v = config[key as keyof typeof config];
      if (v) {
        console.log(v);
      } else {
        info(`${key} is not set`);
      }
    } else {
      // Set
      config[key as keyof typeof config] = value;
      saveFileConfig(config);
      const display = key.includes("key") ? value.slice(0, 8) + "..." : value;
      success(`Set ${key} = ${display}`);
    }
  });
