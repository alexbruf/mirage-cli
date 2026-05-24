import { Command } from "commander";
import { SmsClient } from "../client.ts";
import { formatContactList, error, success } from "../format.ts";

export const contactCommand = new Command("contact")
  .description("Manage contacts")
  .option("--add <phone>", "Add a contact (followed by name)")
  .option("--list", "List all contacts")
  .option("--delete <phone>", "Delete a contact")
  .allowExcessArguments(true)
  .action(async (opts, cmd) => {
    try {
      const client = new SmsClient();

      if (opts.list) {
        const contacts = await client.listContacts();
        console.log(formatContactList(contacts));
      } else if (opts.delete) {
        await client.deleteContact(opts.delete);
        success(`Deleted contact ${opts.delete}`);
      } else if (opts.add) {
        // --add takes the phone, remaining args are the name
        const phone = opts.add;
        const name = cmd.args.join(" ");
        if (!name) {
          error("Usage: sms contact --add <phone> <name>");
          process.exit(1);
        }
        await client.addContact(phone, name);
        success(`Added contact ${name} (${phone})`);
      } else {
        // Default to list
        const contacts = await client.listContacts();
        console.log(formatContactList(contacts));
      }
    } catch (e: unknown) {
      error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });
