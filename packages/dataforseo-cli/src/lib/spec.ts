// Pre-built JSON index produced by `bun run scripts/build-spec-index.ts`.
// 327 KiB instead of the 4 MiB raw OpenAPI YAML; bundlers tree-shake what they want.
import indexJson from "../spec/index.json" with { type: "json" };

export type EndpointMethod = "get" | "post";

export type EndpointInfo = {
  path: string;
  method: EndpointMethod;
  operationId?: string;
  tag?: string;
  description?: string;
  /** First example body the spec ships with, useful for `dfs raw --example`. */
  example?: unknown;
  /** Doc URL extracted from the description, when present. */
  docUrl?: string;
};

const endpoints = indexJson as EndpointInfo[];

export function loadEndpoints(): EndpointInfo[] {
  return endpoints;
}

export function findEndpoint(path: string): EndpointInfo | undefined {
  const norm = normalizePath(path);
  return endpoints.find((e) => normalizePath(e.path) === norm);
}

export function searchEndpoints(query: string, tag?: string): EndpointInfo[] {
  const q = query.toLowerCase();
  return endpoints.filter((e) => {
    if (tag && e.tag?.toLowerCase() !== tag.toLowerCase()) return false;
    if (!q) return true;
    return (
      e.path.toLowerCase().includes(q) ||
      e.operationId?.toLowerCase().includes(q) ||
      e.description?.toLowerCase().includes(q)
    );
  });
}

function normalizePath(p: string): string {
  let s = p.trim();
  if (!s.startsWith("/")) s = "/" + s;
  if (!s.startsWith("/v3/")) s = "/v3" + s;
  return s.replace(/\/+$/, "");
}
