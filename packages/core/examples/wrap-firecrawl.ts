#!/usr/bin/env bun
/**
 * Empirical test: can we wrap firecrawl-cli with @mirage-cli/core, despite
 * it auto-parsing on import and importing `fs`/`child_process`?
 *
 * This example lives in @mirage-cli/core for pedagogical reference. The
 * production wrapper of firecrawl-cli is @mirage-cli/firecrawl, which packages
 * this same logic as a reusable `buildProgram()` + `firecrawlCommand`.
 *
 * Yes — for one-shot-per-request workers — by:
 *   1. Capturing the `program: Command` instance on its first `parseAsync`
 *      call (which firecrawl's module-level `main()` triggers). We no-op
 *      the auto-parse so the host's argv doesn't actually get processed.
 *   2. Using `runCommander(program, argv)` for every subsequent invocation.
 *
 * The `fs`/`child_process` imports the static scanner flagged are stubs in
 * workerd's `nodejs_compat` — they fail only when the host actually CALLS
 * into them (which `--help`, `--version`, and the API-call commands like
 * `scrape`/`search` don't, modulo their `--output-to-file` paths).
 */

import { createRequire } from "node:module";
import { runCommander } from "../src/runner.ts";

// firecrawl-cli is CJS and `require("commander")`s its own nested commander@14
// (its dep), not our top-level commander@12 (our devDep). To patch the SAME
// module instance the CJS code will get, we use createRequire so our and
// firecrawl-cli's require() share a cache entry.
const require = createRequire(import.meta.url);
const fcCommanderPath = require.resolve("commander", {
  paths: [require.resolve("firecrawl-cli")],
});
const { Command } = require(fcCommanderPath) as {
  Command: typeof import("commander").Command;
};

let capturedProgram: InstanceType<typeof Command> | null = null;

// Hook Command.prototype.parseAsync. On the first call (firecrawl's main()),
// capture `this` and short-circuit so the auto-parse doesn't run. Subsequent
// calls from inside runCommander go through to the original.
const origParseAsync = Command.prototype.parseAsync;
Command.prototype.parseAsync = async function (this: InstanceType<typeof Command>, ...args: unknown[]) {
  if (capturedProgram === null) {
    capturedProgram = this;
    return this;
  }
  return (origParseAsync as (...a: unknown[]) => Promise<InstanceType<typeof Command>>).apply(this, args);
};

// Plant argv so firecrawl's main() routes to program.parseAsync() (our hook
// captures it there). Empty argv triggers outputHelp() directly and bypasses
// parseAsync; any non-empty token starting with "-" goes through parseAsync.
process.argv = [process.argv[0] ?? "bun", "firecrawl", "--help"];
process.env.FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY ?? "noop";
process.env.FIRECRAWL_NO_TELEMETRY = "1";

// Trigger module side effects. The auto-parse calls our short-circuited
// parseAsync, which captures `program` and returns immediately.
await import("firecrawl-cli/dist/index.js");

if (capturedProgram === null) {
  console.error("FAIL: did not capture program instance");
  process.exit(1);
}
// process.exit makes the above branch terminal; TS doesn't model this perfectly
// across .exit() return types so assert non-null here.
const program: InstanceType<typeof Command> = capturedProgram!;
console.log("=== captured program ===");
console.log(`name: ${program.name()}`);
console.log(`version: ${program.version()}`);
console.log(`subcommands (${program.commands.length}):`);
console.log(`  ${program.commands.map((c: { name: () => string }) => c.name()).join(", ")}`);

const dec = new TextDecoder();

console.log("\n=== runCommander(firecrawl, ['--version']) ===");
const v = await runCommander(program, ["--version"]);
console.log(`exitCode: ${v.exitCode}`);
console.log(`stdout: ${dec.decode(v.stdout).trim()}`);

console.log("\n=== runCommander(firecrawl, ['--help']) (first 8 lines) ===");
const h = await runCommander(program, ["--help"]);
console.log(`exitCode: ${h.exitCode}`);
console.log(dec.decode(h.stdout).split("\n").slice(0, 8).join("\n"));

console.log("\n=== runCommander(firecrawl, ['scrape', '--help']) (first 6 lines) ===");
const sh = await runCommander(program, ["scrape", "--help"]);
console.log(`exitCode: ${sh.exitCode}`);
console.log(dec.decode(sh.stdout).split("\n").slice(0, 6).join("\n"));

console.log("\n=== runCommander(firecrawl, ['nope']) (unknown command) ===");
const u = await runCommander(program, ["nope"]);
console.log(`exitCode: ${u.exitCode}`);
console.log(`stderr (first 200 chars): ${dec.decode(u.stderr).trim().slice(0, 200)}`);
