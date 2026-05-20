/**
 * Cloudflare Worker entry used to verify @mirage-cli/core runs in a real
 * workerd isolate. Reuses one Commander program across requests; each
 * request supplies argv via POST body.
 *
 * Run with `wrangler dev --port 3003`, then:
 *   curl -s -X POST localhost:3003/run -d '{"argv":["greet","world"]}'
 *   curl -s -X POST localhost:3003/run -d '{"argv":["--help"]}'
 *   curl -s -X POST localhost:3003/run -d '{"argv":["fail"]}' -i
 */

import { Command } from "commander";
import { runCommander, streamCommander } from "../src/runner.ts";

function buildProgram(): Command {
  const program = new Command();
  program.name("demo").version("0.1.0").description("workerd smoke test");

  program.command("greet")
    .description("say hi")
    .argument("<name>")
    .option("-l, --loud")
    .action((name: string, opts: { loud?: boolean }) => {
      const msg = `hello ${name}`;
      console.log(opts.loud ? msg.toUpperCase() : msg);
    });

  program.command("fail")
    .description("always exits with code 2")
    .action(() => {
      console.error("kaboom");
      process.exit(2);
    });

  program.command("count")
    .argument("<n>")
    .action((nStr: string) => {
      const n = Number(nStr);
      for (let i = 1; i <= n; i++) process.stdout.write(`${i}\n`);
    });

  program.command("env")
    .description("prove fetch works from inside the wrapped action")
    .action(async () => {
      const r = await fetch("https://httpbin.org/uuid");
      console.log(await r.text());
    });

  program.command("drip")
    .description("emit lines with delay; used to verify streaming")
    .argument("<n>")
    .action(async (nStr: string) => {
      const n = Number(nStr);
      for (let i = 1; i <= n; i++) {
        process.stdout.write(`tick-${i}\n`);
        await new Promise<void>((r) => setTimeout(r, 50));
      }
    });

  program.command("upper-stdin")
    .description("read stdin, uppercase it, write to stdout")
    .action(async () => {
      const stdin = process.stdin as unknown as AsyncIterable<Uint8Array>;
      const chunks: Uint8Array[] = [];
      for await (const c of stdin) chunks.push(c);
      const total = chunks.reduce((a, b) => a + b.length, 0);
      const merged = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { merged.set(c, off); off += c.length; }
      process.stdout.write(new TextDecoder().decode(merged).toUpperCase());
    });

  return program;
}

const program = buildProgram();
const decoder = new TextDecoder();

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/") {
      return new Response("POST /run with { argv: [...] }\n");
    }
    if (req.method === "GET" && url.pathname === "/raw-stream") {
      // Control: bypass @mirage-cli/core entirely. Just stream 4 lines
      // 50ms apart from a TransformStream. If this also "arrives in 0ms" on
      // the client, workerd local dev is buffering, not our wrapper.
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();
      const enc = new TextEncoder();
      (async () => {
        for (let i = 1; i <= 4; i++) {
          await writer.write(enc.encode(`tick-${i}\n`));
          await new Promise<void>((r) => setTimeout(r, 50));
        }
        await writer.close();
      })();
      return new Response(readable, {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    // POST /stdin?argv=cmd&argv=arg with the request body streamed in as stdin.
    // Returns wrapped CLI's stdout streamed back.
    if (req.method === "POST" && url.pathname === "/stdin") {
      const argv = url.searchParams.getAll("argv");
      if (argv.length === 0) return new Response("missing ?argv=...", { status: 400 });
      const stdin = req.body as ReadableStream<Uint8Array> | null;
      const s = streamCommander(program, argv, { stdin });
      return new Response(s.stdout, {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    if (req.method === "POST" && url.pathname === "/stream") {
      const body = (await req.json()) as { argv?: unknown };
      if (!Array.isArray(body.argv) || !body.argv.every((s) => typeof s === "string")) {
        return new Response('expected { "argv": ["...", ...] }\n', { status: 400 });
      }
      const s = streamCommander(program, body.argv as string[]);
      // Resolve exitCode/stderr asynchronously; stream stdout directly to the
      // response body so the client sees bytes as the action produces them.
      const exitPromise = s.done;
      const stderrPromise = new Response(s.stderr).arrayBuffer();
      const headers = new Headers({ "content-type": "text/plain; charset=utf-8" });
      // Wire trailer-ish info via promise.then before returning? Workers
      // doesn't support trailers; this demo simply streams stdout. Callers
      // can hit /run for the buffered shape if they need exitCode + stderr.
      void exitPromise; void stderrPromise;
      return new Response(s.stdout, { status: 200, headers });
    }
    if (!(req.method === "POST" && url.pathname === "/run")) {
      return new Response("not found", { status: 404 });
    }
    let body: { argv?: unknown };
    try {
      body = (await req.json()) as { argv?: unknown };
    } catch {
      return new Response("bad json", { status: 400 });
    }
    if (!Array.isArray(body.argv) || !body.argv.every((s) => typeof s === "string")) {
      return new Response('expected { "argv": ["...", ...] }\n', { status: 400 });
    }

    const r = await runCommander(program, body.argv as string[]);
    return new Response(r.stdout as unknown as BodyInit, {
      status: r.exitCode === 0 ? 200 : 500,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-exit-code": String(r.exitCode),
        "x-stderr": decoder.decode(r.stderr).replaceAll("\n", "\\n"),
        "x-error": r.error ? String(r.error) : "",
      },
    });
  },
};
