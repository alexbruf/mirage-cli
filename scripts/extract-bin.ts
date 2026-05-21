#!/usr/bin/env bun
/**
 * One-shot refactor: for each `*-cli` package that auto-parses argv on import,
 * extract the parseAsync block from `src/cli.ts` (or `src/dfs.ts`) into a
 * separate `src/bin.ts` so the library entry stays side-effect-free.
 *
 * Without this, importing the library entrypoint executes commander on the
 * host's process.argv (printing help + exit 1). See the bug report — bun
 * bundles `import.meta.main` into `__require.main == __require.module`
 * which evaluates to true in ESM (both undefined).
 *
 * Per package, this script:
 *   1. Snapshots `src/<entry>.ts` (cli.ts or dfs.ts).
 *   2. Removes any trailing block matching `if (import.meta.main) { ... }`
 *      or an unconditional `buildProgram().parseAsync(...)` at top level.
 *   3. Writes `src/bin.ts` with:
 *        import { buildProgram } from "./<entry>.ts";
 *        buildProgram().parseAsync(process.argv).catch(...err handler...);
 *   4. Updates package.json: bin field points to dist/bin.js; build script
 *      adds src/bin.ts as a tsup/bun-build entry.
 *   5. Updates scripts/postbuild.ts: chmod + shebang dist/bin.js.
 *
 * Idempotent — if a bin.ts already exists or the parseAsync block is gone,
 * skips that package.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PKGS = join(ROOT, "packages");

// Only CLI packages with a bin field. firecrawl has no bin (passthrough wrapper).
const TARGETS = [
  { dir: "ahrefs-cli", entry: "cli.ts", binName: "ahrefs" },
  { dir: "clarity-cli", entry: "cli.ts", binName: "clarity" },
  { dir: "dataforseo-cli", entry: "dfs.ts", binName: "dfs", extraBinNames: ["dataforseo"] },
  { dir: "ga4-cli", entry: "cli.ts", binName: "ga4" },
  { dir: "presscart-cli", entry: "cli.ts", binName: "presscart" },
  { dir: "pulse-cli", entry: "cli.ts", binName: "pulse" },
  { dir: "radar-cli", entry: "cli.ts", binName: "radar" },
  { dir: "reddit-cli", entry: "cli.ts", binName: "reddit" },
  { dir: "seogets-cli", entry: "cli.ts", binName: "seogets" },
];

const BIN_TEMPLATE = (entry: string) => `import { buildProgram } from "./${entry.replace(".ts", ".ts")}";

buildProgram()
  .parseAsync(process.argv)
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(JSON.stringify({ error: message }) + "\\n");
    process.exit(1);
  });
`;

interface PkgJson {
  name: string;
  bin?: Record<string, string> | string;
  scripts?: Record<string, string>;
  [k: string]: unknown;
}

function stripParseBlock(source: string): { stripped: string; foundBlock: boolean } {
  // Match either `if (import.meta.main) { ... }` (multi-line) at top level,
  // OR a top-level `buildProgram().parseAsync(...)` call followed by .catch(...).
  // We anchor to end-of-file (with optional trailing whitespace) to ensure
  // we only nuke the trailing entry block, not interior usage.

  // Optional comment line(s) preceding the if-block, then the if-block, then EOF.
  const ifMain = /(?:\n+\/\/[^\n]*)*\n+if \(import\.meta\.main\) \{[\s\S]*?\n\}\s*\n?\s*$/;
  if (ifMain.test(source)) {
    return { stripped: source.replace(ifMain, "\n"), foundBlock: true };
  }

  // Unconditional buildProgram().parseAsync(...).catch(...) at top level
  const uncond = /\n+buildProgram\(\)[\s\S]*?\.parseAsync\([\s\S]*?\)\s*\.catch\([\s\S]*?\}\)\s*;?\s*$/;
  if (uncond.test(source)) {
    return { stripped: source.replace(uncond, "\n"), foundBlock: true };
  }

  return { stripped: source, foundBlock: false };
}

function updatePackageJson(pkgPath: string, t: typeof TARGETS[number]): void {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as PkgJson;

  // bin field — point all aliases to dist/bin.js
  const binNames = [t.binName, ...(t.extraBinNames ?? [])];
  const newBin: Record<string, string> = {};
  for (const name of binNames) newBin[name] = "./dist/bin.js";
  pkg.bin = newBin;

  // build script — add src/bin.ts to the bun build entries
  const scripts = pkg.scripts ?? {};
  let build = scripts.build ?? "";
  if (!build.includes("src/bin.ts")) {
    // Insert "src/bin.ts" before the first "--target=node" or "--outdir=dist"
    build = build.replace(
      /bun build (src\/[^\s]+(?:\s+src\/[^\s]+)*)/,
      (_m, entries: string) => `bun build src/bin.ts ${entries}`,
    );
  }
  scripts.build = build;
  pkg.scripts = scripts;

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

function updatePostbuild(scriptPath: string): void {
  if (!existsSync(scriptPath)) return;
  let src = readFileSync(scriptPath, "utf8");
  // Switch every occurrence of "cli.js" or "dfs.js" in the postbuild to "bin.js"
  src = src
    .replace(/const cliPath = join\(distDir, "cli\.js"\);/g, 'const cliPath = join(distDir, "bin.js");')
    .replace(/const cliPath = join\(distDir, "dfs\.js"\);/g, 'const cliPath = join(distDir, "bin.js");');
  writeFileSync(scriptPath, src);
}

let changed = 0;
let skipped = 0;

for (const t of TARGETS) {
  const pkgDir = join(PKGS, t.dir);
  const entryPath = join(pkgDir, "src", t.entry);
  const binPath = join(pkgDir, "src", "bin.ts");
  const pkgJsonPath = join(pkgDir, "package.json");
  const postbuildPath = join(pkgDir, "scripts", "postbuild.ts");

  if (!existsSync(entryPath)) {
    console.log(`× ${t.dir}: missing src/${t.entry}, skipping`);
    skipped++;
    continue;
  }

  const original = readFileSync(entryPath, "utf8");
  const { stripped, foundBlock } = stripParseBlock(original);

  if (!foundBlock && existsSync(binPath)) {
    console.log(`  ${t.dir}: already migrated, skipping`);
    skipped++;
    continue;
  }

  if (foundBlock) {
    writeFileSync(entryPath, stripped);
    console.log(`✓ ${t.dir}: stripped parseAsync block from src/${t.entry}`);
  } else {
    console.log(`! ${t.dir}: no parseAsync block found in src/${t.entry} — writing bin.ts anyway`);
  }

  writeFileSync(binPath, BIN_TEMPLATE(t.entry));
  console.log(`  ${t.dir}: wrote src/bin.ts`);

  updatePackageJson(pkgJsonPath, t);
  console.log(`  ${t.dir}: updated package.json (bin + build script)`);

  updatePostbuild(postbuildPath);
  console.log(`  ${t.dir}: updated scripts/postbuild.ts`);

  changed++;
}

console.log(`\n${changed} changed, ${skipped} skipped`);
