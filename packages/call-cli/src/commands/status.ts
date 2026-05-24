import { Command } from "commander";
import { CallClient } from "../client.ts";
import { error, formatCallState } from "../format.ts";

export const statusCommand = new Command("status")
  .description("Check call status")
  .argument("[id]", "Call ID (default: latest)")
  .action(async (id?: string) => {
    try {
      const client = new CallClient();
      const call = await client.getCallStatus(id ?? "latest");
      console.log(formatCallState(call));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });
