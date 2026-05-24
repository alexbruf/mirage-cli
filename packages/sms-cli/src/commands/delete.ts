import { Command } from "commander";
import { SmsClient } from "../client.ts";
import { error, success } from "../format.ts";
import * as readline from "readline";

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY ?? false,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase().startsWith("y"));
    });
  });
}

export const deleteCommand = new Command("delete")
  .description("Delete messages")
  .argument("<ids...>", "Message ID(s) or prefixes")
  .option("-f, --force", "Skip confirmation")
  .action(async (ids: string[], opts) => {
    try {
      if (!opts.force) {
        const ok = await confirm(
          `Delete ${ids.length} message(s)? [y/N] `,
        );
        if (!ok) {
          console.log("Cancelled.");
          return;
        }
      }

      const client = new SmsClient();
      for (const id of ids) {
        await client.deleteMessage(id);
      }
      success(`Deleted ${ids.length} message(s)`);
    } catch (e: unknown) {
      error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });
