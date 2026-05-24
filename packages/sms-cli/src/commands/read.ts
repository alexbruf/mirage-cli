import { Command } from "commander";
import { SmsClient } from "../client.ts";
import {
  formatThread,
  formatMessageDetail,
  error,
} from "../format.ts";

export const readCommand = new Command("read")
  .description("Read a conversation (by phone) or a single message (by ID)")
  .argument("<target>", "Phone number (+E.164) or message ID prefix")
  .option("--no-mark", "Don't auto-mark as read")
  .action(async (target: string, opts) => {
    try {
      const client = new SmsClient();

      if (target.startsWith("+")) {
        // Phone number → conversation thread
        const msgs = await client.getConversation(target);
        console.log(formatThread(msgs, target));
        if (opts.mark !== false) {
          await client.markConversationRead(target);
        }
      } else {
        // Message ID prefix
        const msg = await client.getMessage(target);
        console.log(formatMessageDetail(msg));
        if (opts.mark !== false && !msg.read) {
          await client.markRead(msg.id);
        }
      }
    } catch (e: unknown) {
      error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });
