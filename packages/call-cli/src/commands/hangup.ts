import { Command } from "commander";
import { CallClient } from "../client.ts";
import { error, success, formatCallState } from "../format.ts";

export const hangupCommand = new Command("hangup")
  .description("Hang up an active call")
  .argument("<id>", "Call ID")
  .action(async (id: string) => {
    try {
      const client = new CallClient();
      const call = await client.hangup(id);
      success("Call ended.");
      console.log(formatCallState(call));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });
