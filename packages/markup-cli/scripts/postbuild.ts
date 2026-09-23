#!/usr/bin/env bun
import { chmodSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const distDir = join(import.meta.dir, "..", "dist");
const cliPath = join(distDir, "bin.js");

if (!existsSync(cliPath)) {
  console.error(`postbuild: ${cliPath} not found — skipping`);
  process.exit(0);
}

let src = readFileSync(cliPath, "utf8");
if (src.startsWith("#!")) {
  const nl = src.indexOf("\n");
  if (nl > -1) src = src.slice(nl + 1);
}
writeFileSync(cliPath, "#!/usr/bin/env node\n" + src);
chmodSync(cliPath, 0o755);
console.log(`postbuild: ${cliPath} (shebang prepended, chmod +x)`);
