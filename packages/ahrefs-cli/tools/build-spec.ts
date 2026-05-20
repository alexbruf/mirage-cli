#!/usr/bin/env bun
/**
 * Crawl Ahrefs docs reference pages, extract the OpenAPI spec embedded in each
 * page's RSC payload, and merge into one OpenAPI 3.0 document at openapi/ahrefs.json.
 *
 * Each docs page (`/en/api/reference/<section>/<endpoint>`) embeds a partial
 * spec covering just that endpoint. We crawl all section index pages, list
 * endpoint pages, fetch each, extract its spec, and merge paths + components.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = "https://docs.ahrefs.com";
const SECTIONS = [
  "site-explorer",
  "keywords-explorer",
  "batch-analysis",
  "rank-tracker",
  "site-audit",
  "subscription-info",
  "gsc",
] as const;

interface OpenAPISpec {
  openapi: string;
  info?: { title?: string; version?: string };
  servers?: { url: string; description?: string }[];
  paths: Record<string, Record<string, unknown>>;
  components?: {
    schemas?: Record<string, unknown>;
    parameters?: Record<string, unknown>;
    responses?: Record<string, unknown>;
    [k: string]: unknown;
  };
}

async function get(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function listEndpointPages(sectionHtml: string, section: string): string[] {
  const re = new RegExp(`/en/api/reference/${section}/[a-z][a-z0-9-]+`, "g");
  return Array.from(new Set(sectionHtml.match(re) ?? []));
}

function extractRsc(html: string): {
  combined: string;
  refs: Record<string, string>;
} {
  const re = /self\.__next_f\.push\(\[1,("[\s\S]+?")\]\)/g;
  let combined = "";
  for (const m of html.matchAll(re)) {
    try {
      combined += JSON.parse(m[1]!);
    } catch {
      // skip malformed chunks
    }
  }
  // RSC text chunks: "<hexId>:T<hexLen>,<text>\n"
  // hexId can be at start-of-stream or after \n
  const refs: Record<string, string> = {};
  const textRe = /(?:^|\n)([0-9a-f]+):T([0-9a-f]+),/g;
  let m: RegExpExecArray | null;
  while ((m = textRe.exec(combined)) !== null) {
    const id = m[1]!;
    const len = parseInt(m[2]!, 16);
    const start = m.index + m[0].length;
    refs[id] = combined.slice(start, start + len);
  }
  return { combined, refs };
}

function resolveRefs<T>(value: T, refs: Record<string, string>): T {
  if (typeof value === "string") {
    const m = /^\$([0-9a-f]+)$/.exec(value);
    if (m && refs[m[1]!] !== undefined) return refs[m[1]!] as unknown as T;
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveRefs(v, refs)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveRefs(v, refs);
    }
    return out as T;
  }
  return value;
}

function extractSpec(
  rsc: string,
  refs: Record<string, string>,
): OpenAPISpec | null {
  const m = /\{"openapi":"3\.[0-9.]+"/.exec(rsc);
  if (!m) return null;
  const start = m.index;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < rsc.length; i++) {
    const ch = rsc[i]!;
    if (esc) {
      esc = false;
    } else if (ch === "\\") {
      esc = true;
    } else if (ch === '"') {
      inStr = !inStr;
    } else if (!inStr) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(rsc.slice(start, i + 1)) as OpenAPISpec;
            return resolveRefs(parsed, refs);
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

function mergeSpec(target: OpenAPISpec, source: OpenAPISpec, section: string): void {
  // Section spec has servers like https://api.ahrefs.com/v3/<section> and paths like /overview
  // Rewrite to absolute: /<section>/overview under the root server.
  const sectionServer = source.servers?.[0]?.url ?? "";
  const sectionPath = sectionServer.replace(/^https?:\/\/[^/]+\/v3/, "");
  for (const [path, ops] of Object.entries(source.paths)) {
    const full = (sectionPath + path).replace(/\/+$/, "") || `/${section}`;
    if (target.paths[full]) {
      console.warn(`  path collision: ${full}`);
    }
    // Prefix operationId with section to avoid collisions across sections
    // (every endpoint's spec snippet uses a generic id like "getOverview").
    const prefixed: Record<string, unknown> = {};
    for (const [method, op] of Object.entries(ops)) {
      if (op && typeof op === "object" && "operationId" in op) {
        const o = op as Record<string, unknown>;
        const id = String(o.operationId);
        prefixed[method] = { ...o, operationId: `${section}_${id}` };
      } else {
        prefixed[method] = op;
      }
    }
    target.paths[full] = prefixed as Record<string, unknown>;
  }
  if (source.components) {
    target.components = target.components ?? {};
    for (const key of ["schemas", "parameters", "responses"] as const) {
      const src = source.components[key];
      if (!src) continue;
      const dst = (target.components[key] ??= {}) as Record<string, unknown>;
      for (const [name, def] of Object.entries(src)) {
        if (dst[name] && JSON.stringify(dst[name]) !== JSON.stringify(def)) {
          // suffix on collision to avoid silent overwrite
          dst[`${name}__${section}`] = def;
        } else {
          dst[name] = def;
        }
      }
    }
  }
}

async function main() {
  const merged: OpenAPISpec = {
    openapi: "3.0.0",
    info: {
      title: "Ahrefs API v3",
      version: "3.0.0",
    },
    servers: [{ url: "https://api.ahrefs.com/v3" }],
    paths: {},
    components: { schemas: {}, parameters: {}, responses: {} },
  };

  let totalEndpoints = 0;

  for (const section of SECTIONS) {
    process.stderr.write(`\n[${section}]\n`);
    const indexHtml = await get(`${BASE}/en/api/reference/${section}`);
    const endpointPaths = listEndpointPages(indexHtml, section);
    process.stderr.write(`  ${endpointPaths.length} endpoints\n`);

    for (const ep of endpointPaths) {
      const html = await get(BASE + ep);
      const { combined, refs } = extractRsc(html);
      const spec = extractSpec(combined, refs);
      if (!spec) {
        process.stderr.write(`  ✗ ${ep} — no spec found\n`);
        continue;
      }
      const before = Object.keys(merged.paths).length;
      mergeSpec(merged, spec, section);
      const after = Object.keys(merged.paths).length;
      process.stderr.write(`  ✓ ${ep} (+${after - before} paths)\n`);
      totalEndpoints += after - before;
      // be polite
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  const outDir = join(import.meta.dir, "..", "openapi");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "ahrefs.json");
  writeFileSync(outPath, JSON.stringify(merged, null, 2));
  process.stderr.write(
    `\n→ wrote ${outPath}\n  total paths: ${Object.keys(merged.paths).length}\n  total schemas: ${Object.keys(merged.components?.schemas ?? {}).length}\n`,
  );
}

main().catch((e) => {
  process.stderr.write(`fatal: ${(e as Error).message}\n`);
  process.exit(1);
});
