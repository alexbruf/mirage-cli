import { Command } from "commander";
import { SmsClient } from "../client.ts";
import { formatMessageList, error } from "../format.ts";

export const searchCommand = new Command("search")
  .description("Search messages")
  .argument("<query>", "Search text")
  .action(async (query: string) => {
    try {
      const client = new SmsClient();
      const result = await client.search(query);
      console.log(formatMessageList(result.messages));
      if (result.total > 0) {
        console.log(`\n${result.total} result(s)`);
      }
    } catch (e: unknown) {
      error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });
