#!/usr/bin/env bun
/**
 * Drive `@mirage-cli/firecrawl` through mirage-core's RegisteredCommand
 * contract. Firecrawl is unusual because the upstream npm package auto-parses
 * on import; the wrapper handles that under the hood via a one-shot
 * `Command.prototype.parseAsync` capture. The MirageCommandFn surface is
 * identical to the other wrappers — async, drop-in.
 *
 * Run: bun examples/mirage-firecrawl.ts
 */

import {
  command,
  CommandSpec,
  NOOPAccessor,
  Operand,
  OperandKind,
} from "@struktoai/mirage-core";
import { firecrawlCommand } from "@mirage-cli/firecrawl";

const reg = command({
  name: "firecrawl",
  resource: null,
  spec: new CommandSpec({
    rest: new Operand({ kind: OperandKind.TEXT }),
    description: "Firecrawl CLI",
  }),
  fn: firecrawlCommand,
})[0]!;

console.log("=== Registered as mirage command ===");
console.log(`  name:     ${reg.name}`);
console.log(`  resource: ${reg.resource ?? "(none)"}`);
console.log(`  spec:     rest=${reg.spec.rest ? "TEXT" : "(none)"}`);

const dec = new TextDecoder();

async function run(argv: string[]) {
  const [stdout, io] = (await reg.fn(
    new NOOPAccessor(),
    [],
    argv,
    {
      stdin: null,
      flags: {},
      filetypeFns: null,
      cwd: "/",
      resource: { kind: "noop" } as never,
    },
  )) as [unknown, { exitCode: number }];

  const bytes = await new Response(stdout as ReadableStream).arrayBuffer();
  return { stdout: dec.decode(new Uint8Array(bytes)), exitCode: io.exitCode };
}

console.log("\n=== reg.fn(accessor, [], ['--version'], opts) ===");
{
  const r = await run(["--version"]);
  console.log(`exitCode: ${r.exitCode}`);
  console.log(`stdout: ${r.stdout.trim()}`);
}

console.log("\n=== reg.fn(accessor, [], ['scrape', '--help'], opts) — first 6 lines ===");
{
  const r = await run(["scrape", "--help"]);
  console.log(`exitCode: ${r.exitCode}`);
  console.log(r.stdout.split("\n").slice(0, 6).join("\n"));
}

console.log("\n=== reg.fn(accessor, [], ['nope-bad-command'], opts) ===");
{
  const r = await run(["nope-bad-command"]);
  console.log(`exitCode: ${r.exitCode}`);
}
