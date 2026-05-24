import { Command } from "commander";
import { existsSync } from "fs";
import { CallClient } from "../client.ts";
import { error, success, info, formatCallState } from "../format.ts";

export const callCommand = new Command("call")
  .description("Initiate a phone call and play audio")
  .argument("<phone>", "Phone number to call (e.g. +15551234567)")
  .argument("[audio]", "Audio file path or audio ID (aud_xxx)")
  .option("-t, --text <text>", "Generate audio from text via ElevenLabs TTS")
  .option("--voice <id>", "ElevenLabs voice ID")
  .option("--model <id>", "ElevenLabs model ID")
  .option("-s, --silence <secs>", "Silence prefix seconds", "12")
  .option("-w, --wait", "Wait for call to complete")
  .action(async (phone: string, audio: string | undefined, opts) => {
    try {
      const client = new CallClient();
      let audioId: string;

      if (opts.text) {
        // Generate audio from text via TTS
        info(`Generating speech: "${opts.text.slice(0, 60)}${opts.text.length > 60 ? "..." : ""}"`)
        const meta = await client.tts(opts.text, opts.voice, opts.model);
        audioId = meta.id;
        success(`TTS: ${meta.id} (${meta.duration_secs}s)`);
      } else if (!audio) {
        error("Provide an audio file/ID or use --text for TTS");
        process.exit(1);
      } else if (existsSync(audio)) {
        // Upload local file
        info(`Uploading ${audio}...`);
        const meta = await client.uploadAudio(audio);
        audioId = meta.id;
        success(`Uploaded: ${meta.id} (${meta.duration_secs}s)`);
      } else if (audio.startsWith("aud_")) {
        audioId = audio;
      } else {
        error(`File not found and not an audio ID: ${audio}`);
        process.exit(1);
      }

      info(`Calling ${phone}...`);
      const call = await client.initiateCall(
        phone,
        audioId,
        parseInt(opts.silence, 10),
      );
      console.log(formatCallState(call));

      if (opts.wait) {
        info("Waiting for call to complete...");
        let status = call.status;
        while (
          status === "initiating" ||
          status === "ringing" ||
          status === "playing"
        ) {
          await Bun.sleep(2000);
          const updated = await client.getCallStatus(call.id);
          if (updated.status !== status) {
            status = updated.status;
            console.log(formatCallState(updated));
          }
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });
