import { Command } from "commander";
import { CallClient } from "../client.ts";
import { error, success } from "../format.ts";

export const uploadCommand = new Command("upload")
  .description("Upload and convert an audio file")
  .argument("<file>", "Audio file to upload")
  .action(async (file: string) => {
    try {
      const client = new CallClient();
      const meta = await client.uploadAudio(file);
      success(`Uploaded: ${meta.id} (${meta.duration_secs}s)`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });
