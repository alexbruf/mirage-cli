import { Command } from "commander";
import { SmsClient } from "../client.ts";
import { formatConversationList, error } from "../format.ts";

export const conversationsCommand = new Command("conversations")
  .alias("conv")
  .description("List conversation threads with unread counts")
  .action(async () => {
    try {
      const client = new SmsClient();
      const convos = await client.listConversations();
      console.log(formatConversationList(convos));
    } catch (e: unknown) {
      error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });
