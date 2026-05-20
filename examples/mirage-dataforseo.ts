#!/usr/bin/env bun
/**
 * Drive `@mirage-cli/dataforseo` through mirage-core's RegisteredCommand
 * contract — the exact same call path mirage's executor takes internally
 * (see mirage/typescript/packages/core/src/workspace/mount/mount.ts → executeCmd:
 *   `const result = await cmd.fn(accessor, expandedPaths, texts, cmdOpts)`).
 *
 * Run: bun examples/mirage-dataforseo.ts
 */

import {
  command,
  CommandSpec,
  NOOPAccessor,
  Operand,
  OperandKind,
} from "@struktoai/mirage-core";
import { dataforseoCommand } from "@mirage-cli/dataforseo";

const reg = command({
  name: "dfs",
  resource: null,
  spec: new CommandSpec({
    rest: new Operand({ kind: OperandKind.TEXT }),
    description: "DataForSEO CLI",
  }),
  fn: dataforseoCommand,
})[0]!;

console.log("=== Registered as mirage command ===");
console.log(`  name:     ${reg.name}`);
console.log(`  resource: ${reg.resource ?? "(none)"}`);
console.log(`  spec:     rest=${reg.spec.rest ? "TEXT" : "(none)"}`);

const dec = new TextDecoder();

async function run(argv: string[]) {
  const [stdout, io] = (await reg.fn(
    new NOOPAccessor(),
    [],            // paths (none for "rest only" CLI)
    argv,          // texts === argv to forward to dfs
    {              // CommandOpts — minimal viable shape
      stdin: null,
      flags: {},
      filetypeFns: null,
      cwd: "/",
      resource: { kind: "noop" } as never,
    },
  )) as [unknown, { exitCode: number }];

  // Drain the stream (mirage runtimes do this via io.materializeStdout()).
  // toMirageCommandFn guarantees io.exitCode is settled by the time stdout closes.
  const bytes = await new Response(stdout as ReadableStream).arrayBuffer();
  return { stdout: dec.decode(new Uint8Array(bytes)), exitCode: io.exitCode };
}

console.log("\n=== reg.fn(accessor, [], ['--version'], opts) ===");
{
  const r = await run(["--version"]);
  console.log(`exitCode: ${r.exitCode}`);
  console.log(`stdout: ${r.stdout.trim()}`);
}

console.log("\n=== reg.fn(accessor, [], ['keywords', '--help'], opts) — first 6 lines ===");
{
  const r = await run(["keywords", "--help"]);
  console.log(`exitCode: ${r.exitCode}`);
  console.log(r.stdout.split("\n").slice(0, 6).join("\n"));
}

console.log("\n=== reg.fn(accessor, [], ['nope-bad-command'], opts) ===");
{
  const r = await run(["nope-bad-command"]);
  console.log(`exitCode: ${r.exitCode}`);
}
