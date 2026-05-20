#!/usr/bin/env bun
/**
 * Drive `@mirage-cli/ahrefs` through mirage-core's RegisteredCommand contract.
 * Same call path mirage's executor takes internally (mount.executeCmd →
 * `await cmd.fn(accessor, expandedPaths, texts, cmdOpts)`).
 *
 * Run: bun examples/mirage-ahrefs.ts
 */

import {
  command,
  CommandSpec,
  NOOPAccessor,
  Operand,
  OperandKind,
} from "@struktoai/mirage-core";
import { ahrefsCommand } from "@mirage-cli/ahrefs";

const reg = command({
  name: "ahrefs",
  resource: null,
  spec: new CommandSpec({
    rest: new Operand({ kind: OperandKind.TEXT }),
    description: "Ahrefs CLI",
  }),
  fn: ahrefsCommand,
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

console.log("\n=== reg.fn(accessor, [], ['site-explorer', '--help'], opts) — first 6 lines ===");
{
  const r = await run(["site-explorer", "--help"]);
  console.log(`exitCode: ${r.exitCode}`);
  console.log(r.stdout.split("\n").slice(0, 6).join("\n"));
}

console.log("\n=== reg.fn(accessor, [], ['nope-bad-command'], opts) ===");
{
  const r = await run(["nope-bad-command"]);
  console.log(`exitCode: ${r.exitCode}`);
}
