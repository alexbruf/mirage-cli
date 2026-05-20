#!/usr/bin/env bun
/**
 * Run @mirage-cli/core's `checkCompatSource` against the published
 * `firecrawl-cli` package and report what would break in a Cloudflare Worker.
 *
 *   bun add firecrawl-cli                   # in any project
 *   bun examples/scan-firecrawl-cli.ts      # from packages/core/
 *
 * The script walks `node_modules/firecrawl-cli/dist/**`, runs each .js file
 * through `checkCompatSource`, and prints a per-file breakdown plus a summary.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { checkCompatSource } from "../src/compat.ts";

const ROOT = join(process.cwd(), "node_modules", "firecrawl-cli", "dist");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "__tests__") continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

const files = walk(ROOT).sort();
console.log(`Scanning ${files.length} files under ${relative(process.cwd(), ROOT)}\n`);

let totalErrors = 0;
let totalWarnings = 0;
const perFile: Array<{ file: string; errors: number; warnings: number; issues: ReturnType<typeof checkCompatSource>["issues"] }> = [];

for (const f of files) {
  const src = readFileSync(f, "utf-8");
  const r = checkCompatSource(src);
  totalErrors += r.errors;
  totalWarnings += r.warnings;
  if (r.issues.length > 0) {
    perFile.push({ file: relative(ROOT, f), errors: r.errors, warnings: r.warnings, issues: r.issues });
  }
}

console.log(`=== Summary ===`);
console.log(`${totalErrors} errors, ${totalWarnings} warnings across ${perFile.length} files\n`);

console.log(`=== Per-file ===`);
for (const { file, errors, warnings, issues } of perFile) {
  console.log(`\n${file}  (${errors}E ${warnings}W)`);
  for (const i of issues) {
    const tag = i.severity === "error" ? "ERROR" : "WARN ";
    console.log(`  ${tag} L${i.line}  ${i.pattern}  — ${i.hint}`);
  }
}

process.exit(totalErrors === 0 ? 0 : 1);
