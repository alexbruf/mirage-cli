/**
 * Loads the bundled Ahrefs OpenAPI spec and exposes lookup helpers.
 * The spec is the source of truth for `--help` text, parameter validation,
 * defaults, and response shapes.
 */
import specJson from "../openapi/ahrefs.json" with { type: "json" };
const spec = specJson as unknown as {
  openapi: string;
  info: { title?: string; version?: string };
  paths: Record<string, PathItem>;
  components?: {
    parameters?: Record<string, Parameter>;
    schemas?: Record<string, SchemaObject>;
  };
};

export interface Parameter {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  description?: string;
  required?: boolean;
  schema?: {
    type?: string;
    format?: string;
    enum?: unknown[];
    default?: unknown;
    items?: { type?: string };
  };
}

export interface Operation {
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: {
    description?: string;
    required?: boolean;
    content?: Record<string, { schema?: SchemaOrRef }>;
  };
  responses?: Record<string, { content?: Record<string, { schema?: SchemaOrRef }> }>;
}

export type SchemaOrRef = { $ref?: string } & SchemaObject;

export interface SchemaObject {
  type?: string | string[];
  format?: string;
  title?: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  required?: string[];
  properties?: Record<string, SchemaOrRef>;
  items?: SchemaOrRef;
}

export interface Column {
  name: string;
  type: string;
  description: string;
  /** Pulled from "(N units)" prefix in column descriptions, when present. */
  unitsCost?: number;
}

interface PathItem {
  get?: Operation;
  post?: Operation;
  parameters?: Parameter[];
}

const PATHS = spec.paths;
const COMPONENTS = spec.components ?? {};

function resolveParam(p: Parameter | { $ref: string }): Parameter | undefined {
  if ("$ref" in p) {
    const name = p.$ref.split("/").pop()!;
    return COMPONENTS.parameters?.[name];
  }
  return p;
}

export function getOperation(method: "get" | "post", path: string): Operation | undefined {
  return PATHS[path]?.[method];
}

export function getParameters(method: "get" | "post", path: string): Parameter[] {
  const op = getOperation(method, path);
  if (!op?.parameters) return [];
  return op.parameters
    .map((p) => resolveParam(p as Parameter | { $ref: string }))
    .filter((p): p is Parameter => !!p);
}

export function describeEndpoint(method: "get" | "post", path: string): string {
  const op = getOperation(method, path);
  if (!op) return "";
  const parts = [op.summary, op.description].filter(Boolean);
  return parts.join("\n\n");
}

/**
 * Build a help blurb for a single parameter, listing type, enum, default,
 * and the spec's description. This is what citty will show under --help.
 */
export function paramHelp(p: Parameter): string {
  const bits: string[] = [];
  const s = p.schema ?? {};
  if (s.type) bits.push(s.type + (s.format ? ` (${s.format})` : ""));
  if (s.enum?.length) {
    if (s.enum.length > 12) {
      // Long enums (e.g. 200 country codes) bloat the help and waste tokens.
      // Show a few examples and the total count.
      const sample = s.enum.slice(0, 5).join("|");
      bits.push(`one of ${s.enum.length} values, e.g. ${sample}`);
    } else {
      bits.push(`one of: ${s.enum.join("|")}`);
    }
  }
  if (s.default !== undefined) bits.push(`default: ${s.default}`);
  if (p.required) bits.push("required");
  const tag = bits.length ? `[${bits.join(", ")}] ` : "";
  // Collapse whitespace and truncate: citty pads every cell to the longest,
  // so one 5000-char description bloats the whole help. Full descriptions
  // live in the bundled spec (openapi/ahrefs.json) for AI consumers that
  // want the complete text.
  const HELP_MAX = 240;
  let desc = (p.description ?? "").replace(/\s+/g, " ").trim();
  if (desc.length > HELP_MAX) {
    desc = desc.slice(0, HELP_MAX - 1).trimEnd() + "…";
  }
  return tag + desc;
}

/** Walk a $ref ("#/components/schemas/foo") and return the resolved schema. */
function resolveSchema(s: SchemaOrRef | undefined): SchemaObject | undefined {
  if (!s) return undefined;
  if (s.$ref) {
    const name = s.$ref.split("/").pop()!;
    return spec.components?.schemas?.[name];
  }
  return s as SchemaObject;
}

/**
 * For POST endpoints, walk requestBody.content.application/json.schema.properties
 * and synthesize Parameter-shaped entries. Lets the same builder code handle GET
 * query params and POST body fields uniformly.
 */
export function getRequestBodyParams(
  method: "get" | "post",
  path: string,
): Parameter[] {
  if (method !== "post") return [];
  const op = getOperation(method, path);
  const schema = resolveSchema(
    op?.requestBody?.content?.["application/json"]?.schema,
  );
  if (!schema?.properties) return [];
  const required = new Set(schema.required ?? []);
  const out: Parameter[] = [];
  for (const [name, propRaw] of Object.entries(schema.properties)) {
    const prop = resolveSchema(propRaw) ?? {};
    out.push({
      name,
      in: "query", // we pretend it's a query param; the builder routes to body
      description: prop.description,
      required: required.has(name),
      schema: {
        type: Array.isArray(prop.type) ? prop.type[0] : prop.type,
        format: prop.format,
        enum: prop.enum,
        default: prop.default,
        items: prop.items
          ? { type: (resolveSchema(prop.items) ?? {}).type as string | undefined }
          : undefined,
      },
    });
  }
  return out;
}

/**
 * Extract the column list for a list-style endpoint by looking at
 * 200 response → schema → properties[rowsKey].items.properties.
 * Returns the columns the user can pass to --select.
 */
export function getResponseColumns(
  method: "get" | "post",
  path: string,
  rowsKey: string | undefined,
): Column[] {
  if (!rowsKey) return [];
  const op = getOperation(method, path);
  const respSchema = resolveSchema(
    op?.responses?.["200"]?.content?.["application/json"]?.schema,
  );
  const arr = resolveSchema(respSchema?.properties?.[rowsKey]);
  const itemSchema = resolveSchema(arr?.items);
  const props = itemSchema?.properties;
  if (!props) {
    // Some endpoints return the object directly (e.g. metrics under rowsKey).
    const direct = resolveSchema(respSchema?.properties?.[rowsKey]);
    if (direct?.properties) {
      return Object.entries(direct.properties).map(([name, p]) =>
        columnFromProp(name, resolveSchema(p) ?? {}),
      );
    }
    return [];
  }
  return Object.entries(props).map(([name, p]) =>
    columnFromProp(name, resolveSchema(p) ?? {}),
  );
}

function columnFromProp(name: string, p: SchemaObject): Column {
  const rawType = Array.isArray(p.type) ? p.type[0] : p.type;
  const type = rawType ?? "any";
  const nullable = Array.isArray(p.type) && p.type.includes("null");
  const desc = (p.description ?? "").replace(/\s+/g, " ").trim();
  // Ahrefs prefixes some descriptions with "(N units)" indicating extra cost
  const costMatch = /^\((\d+)\s*units?\)\s*/.exec(desc);
  return {
    name,
    type: type + (nullable ? "?" : ""),
    description: costMatch ? desc.slice(costMatch[0].length) : desc,
    unitsCost: costMatch ? Number(costMatch[1]) : undefined,
  };
}

export const SPEC = spec;
