/**
 * call CLI as a commander.js program. Vendored from call-cli/src/cli (the
 * server half of the upstream repo is not shipped). Auth + config via
 * `~/.config/call/config.json` or the `CALL_SERVER_URL` / `CALL_API_KEY`
 * env vars.
 *
 * Read-only subcommands: `status`, `config show`.
 * Mutating: `call` (place an outbound call with TTS or pre-uploaded audio),
 * `hangup`, `upload`, `config set`. These reach into the Cloudflare Worker
 * backend which relays to an Android phone over Bluetooth/ADB.
 */
import { Command } from "commander";
import { callCommand } from "./commands/call.ts";
import { statusCommand } from "./commands/status.ts";
import { hangupCommand } from "./commands/hangup.ts";
import { uploadCommand } from "./commands/upload.ts";
import { configCommand } from "./commands/config.ts";
import { CallClient } from "./client.ts";

let cached: Command | null = null;

export function buildProgram(): Command {
  if (cached !== null) return cached;
  const program = new Command()
    .name("call")
    .description("Phone call + audio injection CLI")
    .version("0.1.6");

  program.addCommand(callCommand);
  program.addCommand(statusCommand);
  program.addCommand(hangupCommand);
  program.addCommand(uploadCommand);
  program.addCommand(configCommand);

  program.action(async () => {
    try {
      const client = new CallClient();
      const health = await client.health();
      const btStatus = health.bluetooth_connected ? "connected" : "disconnected";
      process.stdout.write(
        `call-server: ${health.status} | BT: ${btStatus} | Active calls: ${health.active_calls}\n`,
      );
    } catch (err) {
      process.stderr.write(`Cannot reach call-server: ${err}\n`);
      process.exit(1);
    }
  });

  cached = program;
  return program;
}
