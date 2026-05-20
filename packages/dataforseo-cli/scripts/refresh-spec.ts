#!/usr/bin/env bun
/**
 * Refresh the bundled OpenAPI spec from DataForSEO's official repo.
 * Usage: bun run spec:refresh
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const URL =
  "https://raw.githubusercontent.com/dataforseo/OpenApiDocumentation/main/openapi_specification.yaml";

const dest = join(import.meta.dir, "..", "src", "spec", "openapi.yaml");

console.log(`Fetching ${URL} ...`);
const res = await fetch(URL);
if (!res.ok) {
  console.error(`Failed: HTTP ${res.status}`);
  process.exit(1);
}
const body = await res.text();
writeFileSync(dest, body);
console.log(`Wrote ${(body.length / 1024).toFixed(1)} KiB to ${dest}`);
