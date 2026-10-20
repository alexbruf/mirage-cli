#!/usr/bin/env bun
import { chmodSync, copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");
const cliPath = join(dist, "bin.js");
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

copyFileSync(join(root, "src", "wire.d.ts"), join(dist, "wire.d.ts"));

const relative = /(from\s*["'])(\.\.?\/[\w./-]+?)(["'])/g;
for (const entry of readdirSync(dist, { recursive: true, encoding: "utf8" })) {
  if (!entry.endsWith(".d.ts")) continue;
  const path = join(dist, entry);
  const text = readFileSync(path, "utf8");
  const fixed = text.replace(relative, (_, head: string, specifier: string, tail: string) =>
    specifier.endsWith(".js") ? `${head}${specifier}${tail}` : `${head}${specifier}.js${tail}`,
  );
  if (fixed !== text) writeFileSync(path, fixed);
}
console.log(`postbuild: ${dist} declarations point at .js files`);
