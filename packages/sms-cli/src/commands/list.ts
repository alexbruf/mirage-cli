import { Command } from "commander";
import { SmsClient } from "../client.ts";
import { formatMessageList, error } from "../format.ts";

export const listCommand = new Command("list")
  .description("List messages")
  .option("-u, --unread", "Show unread only")
  .option("-s, --sent", "Show sent only")
  .option("-a, --all", "Show all (incoming + outgoing)")
  .option("-n, --limit <n>", "Number of messages", "20")
  .action(async (opts) => {
    try {
      const client = new SmsClient();
      const params: Record<string, string> = { limit: opts.limit };
      if (opts.unread) params.unread = "true";
      if (opts.sent) params.direction = "out";
      else if (!opts.all) params.direction = "in";
      const messages = await client.listMessages(params);
      console.log(formatMessageList(messages));
    } catch (e: unknown) {
      error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });
