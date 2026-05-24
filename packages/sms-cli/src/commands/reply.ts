import { Command } from "commander";
import { SmsClient } from "../client.ts";
import { shortId, dirArrow, error, success } from "../format.ts";
import chalk from "chalk";

export const replyCommand = new Command("reply")
  .description("Reply to a conversation (shows last message for context)")
  .argument("<phone>", "Phone number to reply to")
  .argument("[message...]", "Message text (or pipe via stdin)")
  .option("--sim <n>", "SIM card number")
  .action(async (phone: string, messageParts: string[], opts) => {
    try {
      const client = new SmsClient();

      // Show last message for context
      const thread = await client.getConversation(phone);
      if (thread.length > 0) {
        const last = thread[thread.length - 1]!;
        const arrow = dirArrow(last.direction);
        console.log(
          chalk.dim(`Last: ${arrow} ${last.text.slice(0, 60)}`),
        );
        console.log();
      }

      let text = messageParts.join(" ");
      if (!text) {
        text = await Bun.stdin.text();
      }
      text = text.trim();
      if (!text) {
        error("Message text is required");
        process.exit(1);
      }

      const sim = opts.sim ? parseInt(opts.sim, 10) : undefined;
      const msg = await client.send(phone, text, sim);
      success(`Sent [${shortId(msg.id)}] → ${phone}`);
    } catch (e: unknown) {
      error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });
