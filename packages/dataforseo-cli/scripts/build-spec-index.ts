#!/usr/bin/env bun
/**
 * Compile the bulky openapi_specification.yaml into a slim JSON index
 * with just the fields the CLI actually consults at runtime.
 * Output: src/spec/index.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

type SlimEndpoint = {
  path: string;
  method: "get" | "post";
  operationId?: string;
  tag?: string;
  description?: string;
  docUrl?: string;
  example?: unknown;
};

const root = join(import.meta.dir, "..");
const specPath = join(root, "src", "spec", "openapi.yaml");
const outPath = join(root, "src", "spec", "index.json");

const raw = readFileSync(specPath, "utf8");
const doc = YAML.parse(raw) as { paths?: Record<string, Record<string, unknown>> };

const endpoints: SlimEndpoint[] = [];
for (const [path, ops] of Object.entries(doc.paths ?? {})) {
  for (const [method, op] of Object.entries(ops)) {
    if (method !== "get" && method !== "post") continue;
    const opObj = op as Record<string, unknown>;
    const tags = opObj.tags as string[] | undefined;
    const description = opObj.description as string | undefined;
    endpoints.push({
      path,
      method: method as "get" | "post",
      operationId: opObj.operationId as string | undefined,
      tag: tags?.[0],
      description,
      docUrl: extractDocUrl(description),
      example: extractExample(opObj),
    });
  }
}

writeFileSync(outPath, JSON.stringify(endpoints));
const inSize = (raw.length / 1024).toFixed(1);
const outSize = (JSON.stringify(endpoints).length / 1024).toFixed(1);
console.log(`built ${endpoints.length} endpoints: ${inSize} KiB YAML → ${outSize} KiB JSON`);

function extractExample(op: Record<string, unknown>): unknown {
  const body = op.requestBody as
    | { content?: Record<string, { example?: unknown; schema?: { example?: unknown; items?: { example?: unknown } } }> }
    | undefined;
  const json = body?.content?.["application/json"];
  if (!json) return undefined;
  if (json.example !== undefined) return json.example;
  if (json.schema?.example !== undefined) return json.schema.example;
  return undefined;
}

function extractDocUrl(description?: string): string | undefined {
  if (!description) return undefined;
  const m = description.match(/https?:\/\/docs\.dataforseo\.com\/[^\s'"]+/);
  return m ? m[0].replace(/\?.*$/, "") : undefined;
}
