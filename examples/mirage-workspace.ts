#!/usr/bin/env bun
/**
 * End-to-end demo: drop all three @mirage-cli/* wrappers into a real
 * mirage-node `Workspace` and exercise them via the full shell-parser path.
 *
 *   await ws.execute("dfs --version")
 *
 * This is the canonical "drop-in" — three lines per CLI (resource factory,
 * addMount, execute) and you're done.
 *
 * Run: bun examples/mirage-workspace.ts
 */

import { Workspace } from "@struktoai/mirage-node";
import { RAMResource } from "@struktoai/mirage-core";
import { dataforseoResource } from "@mirage-cli/dataforseo";
import { ahrefsResource } from "@mirage-cli/ahrefs";
import { firecrawlResource } from "@mirage-cli/firecrawl";

// 1. Start a Workspace. mirage-node wires up the shell parser automatically.
//    A default mount (RAMResource at "/") gives the executor a cwd to operate
//    in; our CLI commands are "general" (resource: null) so they work everywhere.
const ws = new Workspace({
  "/": new RAMResource(),
});

// 2. Drop each wrapper in via addMount. Prefix is cosmetic for general commands.
//    `<vendor>Resource()` is async — it lazy-imports @struktoai/mirage-core
//    so non-mirage consumers can skip that install.
ws.addMount("/cli/dfs", await dataforseoResource());
ws.addMount("/cli/ahrefs", await ahrefsResource());
ws.addMount("/cli/firecrawl", await firecrawlResource());

console.log("=== Workspace mounted with 4 resources ===");

// 3. Execute commands as if you were typing in a shell.
//
// The wrappers construct `RegisteredCommand` directly (not via mirage's
// `command()` factory) — that bypasses mirage's spec-based `--help` intercept
// so commander's real help text reaches the user.
const cases = [
  "dfs --version",
  "ahrefs --version",
  "firecrawl --version",
  "dfs --help",
  "ahrefs --help",
  "firecrawl scrape --help",
  // Non-zero exit propagates correctly:
  "dfs nonexistent-subcmd",
];

for (const cmd of cases) {
  console.log(`\n$ ${cmd}`);
  const r = await ws.execute(cmd);
  const stdout = r.stdoutText.trim();
  const stderr = r.stderrText.trim();
  console.log(`  exitCode: ${r.exitCode}`);
  if (stdout) console.log(`  stdout:   ${stdout.split("\n")[0]?.slice(0, 80)}`);
  if (stderr) console.log(`  stderr:   ${stderr.split("\n")[0]?.slice(0, 80)}`);
}

await ws.close();
