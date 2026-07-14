#!/usr/bin/env bun
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const cliPath = join(import.meta.dir, "..", "dist", "bin.js");
if (!existsSync(cliPath)) {
  console.error(`postbuild: ${cliPath} not found; skipping`);
  process.exit(0);
}

let source = readFileSync(cliPath, "utf8");
if (source.startsWith("#!")) {
  const newline = source.indexOf("\n");
  if (newline >= 0) source = source.slice(newline + 1);
}
writeFileSync(cliPath, "#!/usr/bin/env node\n" + source);
chmodSync(cliPath, 0o755);
console.log(`postbuild: ${cliPath} (shebang prepended, chmod +x)`);
