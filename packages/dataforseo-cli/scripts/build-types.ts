#!/usr/bin/env bun
/**
 * Emit TypeScript declarations for the library entrypoint into dist/.
 * Bun's bundler doesn't emit .d.ts; we run tsc just for that.
 */
import { spawnSync } from "node:child_process";

const result = spawnSync(
  "bun",
  [
    "x",
    "tsc",
    "--declaration",
    "--emitDeclarationOnly",
    "--outDir",
    "dist",
    "--rootDir",
    "src",
    "--module",
    "esnext",
    "--moduleResolution",
    "bundler",
    "--target",
    "esnext",
    "--allowImportingTsExtensions",
    "--strict",
    "--skipLibCheck",
    "--esModuleInterop",
    "src/index.ts",
    "src/dfs.ts",
  ],
  { stdio: "inherit" },
);
process.exit(result.status ?? 0);
