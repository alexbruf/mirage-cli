#!/usr/bin/env bun
/**
 * Release script for @mirage-cli/*.
 *
 * Why this exists instead of just `bun publish` or `bunx changeset publish`:
 *
 *  1. `workspace:^` protocol expansion — `npm publish` (used under the hood by
 *     `bunx changeset publish`) does NOT rewrite `workspace:^` to a real
 *     caret range. `bun publish` does, but we want a single tool that also
 *     handles (2). So we rewrite manually before calling `npm publish`.
 *
 *  2. Strip the `bun` export condition — every package has an in-repo
 *     `exports.<key>.bun: "./src/index.ts"` for zero-build cross-workspace
 *     dev. That's fine inside the monorepo but breaks for consumers: the
 *     `bun` condition wins over `import`, but the tarball doesn't ship
 *     `src/` (files: ["dist/", "README.md"]). Strip the condition on
 *     publish so consumers see just `{ types, import }`.
 *
 * Flow, per package:
 *   - Snapshot the source package.json.
 *   - Mutate it: strip exports.<key>.bun, expand workspace:^ deps.
 *   - Run `npm publish --access=public`.
 *   - Restore from snapshot.
 *
 * Auth: relies on `NPM_CONFIG_USERCONFIG` pointing at an .npmrc with an
 * automation token, OR a logged-in ~/.npmrc. Usage:
 *
 *   NPM_CONFIG_USERCONFIG=/tmp/publish-npmrc bun run release
 *
 * Optional flags:
 *   --dry-run   Show what would happen, don't call npm publish.
 *   --only=<n>  Comma-separated list of package names to publish (matches
 *               the trailing path segment, e.g. --only=core,ga4-cli).
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PKGS = join(ROOT, "packages");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const onlyFlag = args.find((a) => a.startsWith("--only="));
const only = onlyFlag ? new Set(onlyFlag.slice("--only=".length).split(",").map((s) => s.trim())) : null;

interface PkgJson {
  name: string;
  version: string;
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [k: string]: unknown;
}

const dirs = readdirSync(PKGS).filter((d) => existsSync(join(PKGS, d, "package.json")));

// First pass: collect all workspace versions for protocol expansion
const versions = new Map<string, string>();
for (const d of dirs) {
  const pkg = JSON.parse(readFileSync(join(PKGS, d, "package.json"), "utf8")) as PkgJson;
  versions.set(pkg.name, pkg.version);
}

function rewriteForPublish(pkg: PkgJson): void {
  // 1. Strip `bun` from every export condition
  if (pkg.exports && typeof pkg.exports === "object") {
    for (const key of Object.keys(pkg.exports)) {
      const exp = (pkg.exports as Record<string, unknown>)[key];
      if (exp && typeof exp === "object" && !Array.isArray(exp)) {
        const cond = exp as Record<string, unknown>;
        if ("bun" in cond) delete cond.bun;
      }
    }
  }
  // 2. Expand workspace:* / workspace:^ / workspace:~ in deps
  const fields = ["dependencies", "peerDependencies", "devDependencies"] as const;
  for (const field of fields) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [k, v] of Object.entries(deps)) {
      if (typeof v !== "string" || !v.startsWith("workspace:")) continue;
      const ver = versions.get(k);
      if (!ver) {
        throw new Error(`${pkg.name}: unknown workspace dep ${k} (not in workspace)`);
      }
      if (v === "workspace:*") deps[k] = ver;
      else if (v === "workspace:^") deps[k] = `^${ver}`;
      else if (v === "workspace:~") deps[k] = `~${ver}`;
      else {
        // workspace:^x.y.z form — use as-is, stripping the prefix
        deps[k] = v.slice("workspace:".length);
      }
    }
  }
}

// Topological order: leaves first. core has no workspace deps, -cli packages
// have no workspace deps (only commander), wrappers depend on core + their -cli.
// We sort by dependency count so dependents publish after their deps.
function topologicalOrder(): string[] {
  const order: string[] = [];
  const visited = new Set<string>();
  const visit = (dir: string) => {
    if (visited.has(dir)) return;
    visited.add(dir);
    const pkg = JSON.parse(readFileSync(join(PKGS, dir, "package.json"), "utf8")) as PkgJson;
    const allDeps = { ...pkg.dependencies, ...pkg.peerDependencies };
    for (const dep of Object.keys(allDeps)) {
      if (!versions.has(dep)) continue;
      const depDir = dirs.find((d) => {
        const p = JSON.parse(readFileSync(join(PKGS, d, "package.json"), "utf8")) as PkgJson;
        return p.name === dep;
      });
      if (depDir) visit(depDir);
    }
    order.push(dir);
  };
  for (const d of dirs) visit(d);
  return order;
}

const ordered = topologicalOrder();

let published = 0;
let skipped = 0;
let failed: string[] = [];

for (const d of ordered) {
  const pkgPath = join(PKGS, d, "package.json");
  const original = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(original) as PkgJson;

  if (only && !only.has(d) && !only.has(pkg.name)) {
    skipped++;
    continue;
  }

  rewriteForPublish(pkg);

  if (dryRun) {
    console.log(`\n=== [dry-run] ${pkg.name}@${pkg.version} ===`);
    console.log(JSON.stringify({ exports: pkg.exports, dependencies: pkg.dependencies, peerDependencies: pkg.peerDependencies }, null, 2));
    continue;
  }

  console.log(`\n→ Publishing ${pkg.name}@${pkg.version}`);
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  try {
    execSync("npm publish --access=public", { cwd: join(PKGS, d), stdio: "inherit" });
    published++;
  } catch (err) {
    failed.push(pkg.name);
    console.error(`× ${pkg.name} failed:`, err instanceof Error ? err.message : err);
  } finally {
    writeFileSync(pkgPath, original);
  }
}

console.log(`\n=== Summary ===`);
console.log(`  published: ${published}`);
console.log(`  skipped:   ${skipped}`);
console.log(`  failed:    ${failed.length}${failed.length ? ` (${failed.join(", ")})` : ""}`);
if (failed.length) process.exit(1);
