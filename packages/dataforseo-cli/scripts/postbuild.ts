#!/usr/bin/env bun
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dist = join(import.meta.dir, "..", "dist", "dfs.js");
let body = readFileSync(dist, "utf8");
// Strip any pre-existing shebang(s) from the bundler output.
body = body.replace(/^(#![^\n]*\n)+/g, "");
const shebang = "#!/usr/bin/env node\n";
writeFileSync(dist, shebang + body);
chmodSync(dist, 0o755);
console.log(`Wrote shebang + chmod +x ${dist}`);
