import { Command } from "commander";
import { SmsClient } from "../client.ts";
import { shortId, error, success } from "../format.ts";

export const sendCommand = new Command("send")
  .description("Send an SMS")
  .argument("<phone>", "Recipient phone number")
  .argument("[message...]", "Message text (or pipe via stdin)")
  .option("--sim <n>", "SIM card number")
  .action(async (phone: string, messageParts: string[], opts) => {
    try {
      let text = messageParts.join(" ");
      if (!text) {
        text = await Bun.stdin.text();
      }
      text = text.trim();
      if (!text) {
        error("Message text is required (pass as argument or pipe to stdin)");
        process.exit(1);
      }

      const client = new SmsClient();
      const sim = opts.sim ? parseInt(opts.sim, 10) : undefined;
      const msg = await client.send(phone, text, sim);
      success(`Sent [${shortId(msg.id)}] → ${phone}`);
    } catch (e: unknown) {
      error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });
