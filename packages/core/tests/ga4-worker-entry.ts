/**
 * Workerd smoke test for @mirage-cli/ga4-cli. Loads the fetch-only CLI's
 * Commander program in a Worker and exposes /run to drive it via argv.
 *
 *   POST /run { "argv": ["--help"] }
 *   POST /run { "argv": ["accounts"] }   # needs GA4_OAUTH_ACCESS_TOKEN
 */

import { buildProgram } from "@mirage-cli/ga4-cli";
import { runCommander } from "../src/runner.ts";

const program = buildProgram();
const decoder = new TextDecoder();

export default {
  async fetch(req: Request, env: Record<string, string>): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/") {
      return new Response('POST /run with { "argv": ["...", ...] }\n');
    }
    if (!(req.method === "POST" && url.pathname === "/run")) {
      return new Response("not found", { status: 404 });
    }
    let body: { argv?: unknown; token?: unknown; property?: unknown };
    try {
      body = (await req.json()) as { argv?: unknown; token?: unknown; property?: unknown };
    } catch {
      return new Response("bad json", { status: 400 });
    }
    if (!Array.isArray(body.argv) || !body.argv.every((s) => typeof s === "string")) {
      return new Response('expected { "argv": ["...", ...] }\n', { status: 400 });
    }

    // Auth: prefer body.token (per-request, used by smoke tests); fall back to
    // worker env binding (production use).
    const token = typeof body.token === "string" ? body.token : env.GA4_OAUTH_ACCESS_TOKEN;
    if (token) process.env.GA4_OAUTH_ACCESS_TOKEN = token;
    const property = typeof body.property === "string" ? body.property : env.GA_PROPERTY_ID;
    if (property) process.env.GA_PROPERTY_ID = property;

    const r = await runCommander(program, body.argv as string[]);
    return new Response(r.stdout as unknown as BodyInit, {
      status: r.exitCode === 0 ? 200 : 500,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-exit-code": String(r.exitCode),
        "x-stderr": decoder.decode(r.stderr).replaceAll("\n", "\\n").slice(0, 1500),
      },
    });
  },
};
