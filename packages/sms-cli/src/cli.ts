/**
 * sms CLI as a commander.js program. Vendored from sms-cli/src/cli (the
 * server half of the upstream repo is not shipped). Auth + config via
 * `~/.config/sms/config.json` or the `SMS_SERVER_URL` / `SMS_API_KEY` env
 * vars.
 *
 * Read-only subcommands: `list`, `conversations`, `read`, `search`,
 * `contact`, `config show`.
 * Mutating: `send`, `reply`, `mark-read`, `mark-unread`, `delete`,
 * `config set`. These reach into the Cloudflare Worker backend which
 * relays to the Android SMS Gateway app on a paired phone.
 */
import { Command } from "commander";
import { SmsClient } from "./client.ts";
import { listCommand } from "./commands/list.ts";
import { conversationsCommand } from "./commands/conversations.ts";
import { readCommand } from "./commands/read.ts";
import { sendCommand } from "./commands/send.ts";
import { replyCommand } from "./commands/reply.ts";
import { markReadCommand, markUnreadCommand } from "./commands/mark.ts";
import { deleteCommand } from "./commands/delete.ts";
import { searchCommand } from "./commands/search.ts";
import { contactCommand } from "./commands/contact.ts";
import { configCommand } from "./commands/config.ts";

let cached: Command | null = null;

export function buildProgram(): Command {
  if (cached !== null) return cached;
  const program = new Command()
    .name("sms")
    .description("SMS inbox CLI")
    .version("0.1.6")
    .action(async () => {
      try {
        const client = new SmsClient();
        const health = await client.health();
        if (health.unread_count > 0) {
          process.stdout.write(`${health.unread_count} unread message(s)\n`);
        } else {
          process.stdout.write("No unread messages.\n");
        }
      } catch (e: unknown) {
        process.stderr.write(`Error: ${e instanceof Error ? e.message : String(e)}\n`);
        process.exit(1);
      }
    });

  program.addCommand(listCommand);
  program.addCommand(conversationsCommand);
  program.addCommand(readCommand);
  program.addCommand(sendCommand);
  program.addCommand(replyCommand);
  program.addCommand(markReadCommand);
  program.addCommand(markUnreadCommand);
  program.addCommand(deleteCommand);
  program.addCommand(searchCommand);
  program.addCommand(contactCommand);
  program.addCommand(configCommand);

  cached = program;
  return program;
}
