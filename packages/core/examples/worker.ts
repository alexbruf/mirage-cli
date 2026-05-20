/**
 * Example: invoke a Commander CLI from inside a Cloudflare Worker.
 *
 * The worker accepts POST /run with `{ "argv": [...] }` and returns the
 * captured stdout. Mirage (or anything else) just speaks JSON.
 *
 * Compile this with `wrangler dev` or your usual worker bundler. The
 * Commander program itself must also be Worker-safe — run checkCompatSource
 * against its source as part of CI to catch fs/child_process/etc usage
 * before you ship.
 */

import { Command } from "commander";
import { runCommander } from "../src/runner.ts";

// Build the program once at module scope so it's reused across requests.
const program = new Command();
program.name("demo").version("0.1.0");
program.command("greet")
  .argument("<name>")
  .option("-l, --loud")
  .action((name: string, opts: { loud?: boolean }) => {
    const msg = `hello ${name}`;
    console.log(opts.loud ? msg.toUpperCase() : msg);
  });

// Cloudflare Workers entrypoint shape.
export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method !== "POST" || new URL(req.url).pathname !== "/run") {
      return new Response("POST /run with { argv: [...] }", { status: 404 });
    }
    const body = (await req.json()) as { argv?: unknown };
    if (!Array.isArray(body.argv) || !body.argv.every((s) => typeof s === "string")) {
      return new Response('expected { "argv": ["...", ...] }', { status: 400 });
    }
    const r = await runCommander(program, body.argv as string[]);
    return new Response(r.stdout as BodyInit, {
      status: r.exitCode === 0 ? 200 : 500,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-exit-code": String(r.exitCode),
        "x-stderr-length": String(r.stderr.byteLength),
      },
    });
  },
};
