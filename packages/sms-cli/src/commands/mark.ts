import { Command } from "commander";
import { SmsClient } from "../client.ts";
import { error, success } from "../format.ts";

export const markReadCommand = new Command("mark-read")
  .description("Mark messages as read")
  .argument("<ids...>", "Message ID(s) or prefixes")
  .action(async (ids: string[]) => {
    try {
      const client = new SmsClient();
      for (const id of ids) {
        const msg = await client.getMessage(id);
        await client.markRead(msg.id);
      }
      success(`Marked ${ids.length} message(s) as read`);
    } catch (e: unknown) {
      error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });

export const markUnreadCommand = new Command("mark-unread")
  .description("Mark messages as unread")
  .argument("<ids...>", "Message ID(s) or prefixes")
  .action(async (ids: string[]) => {
    try {
      const client = new SmsClient();
      for (const id of ids) {
        const msg = await client.getMessage(id);
        await client.markUnread(msg.id);
      }
      success(`Marked ${ids.length} message(s) as unread`);
    } catch (e: unknown) {
      error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });
