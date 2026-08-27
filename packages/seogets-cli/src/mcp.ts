/**
 * MCP JSON-RPC 2.0 client over Streamable HTTP for the SEO Gets MCP at
 * https://app.seogets.com/mcp. The endpoint returns SSE-encoded responses
 * (`event: message` / `data: {...}`) even for one-shot RPCs, so we parse
 * the `data:` line out of the response body.
 *
 * Env:
 *   SEOGETS_MCP_TOKEN — required bearer token
 *   SEOGETS_MCP_URL   — optional override (default https://app.seogets.com/mcp)
 */

import { normalizeGscPage, type GscPage, type GscPageArgs } from "./gsc-top.ts";

const DEFAULT_URL = "https://app.seogets.com/mcp";

export interface McpClientOpts {
  token?: string;
  url?: string;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export class McpError extends Error {
  constructor(
    public code: number,
    message: string,
    public data?: unknown,
  ) {
    super(`[${code}] ${message}`);
    this.name = "McpError";
  }
}

export class McpClient {
  private readonly token: string;
  private readonly url: string;
  private nextId = 1;

  constructor(opts: McpClientOpts = {}) {
    const token = opts.token ?? process.env.SEOGETS_MCP_TOKEN;
    if (!token) {
      throw new Error(
        "SEO Gets MCP token not configured. Set SEOGETS_MCP_TOKEN env var or pass --token.",
      );
    }
    this.token = token;
    this.url = (opts.url ?? process.env.SEOGETS_MCP_URL ?? DEFAULT_URL).replace(/\/$/, "");
  }

  /** Raw JSON-RPC call. Returns the `result` field (or throws on `error`). */
  async rpc<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
    }
    const payload = await this.readJsonRpc(res);
    if (payload.error) {
      const err = payload.error as { code?: number; message?: string; data?: unknown };
      throw new McpError(err.code ?? -32000, err.message ?? "MCP error", err.data);
    }
    return payload.result as T;
  }

  /** List available tools (MCP `tools/list`). */
  async listTools(): Promise<McpTool[]> {
    const res = await this.rpc<{ tools: McpTool[] }>("tools/list");
    return res.tools ?? [];
  }

  /**
   * Call a tool. Returns whatever the server returns under `result`. For most
   * SEO Gets tools the result is already the data; some MCP servers wrap it
   * in `{ content: [{ type: "text", text: "..." }] }` — `unwrapToolResult`
   * handles both cases.
   */
  async callTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const result = await this.rpc<T>("tools/call", { name, arguments: args });
    assertToolResponseOk(args, result);
    return result;
  }

  /** Fetch and normalize one GSC page, including SEO Gets' TSV-in-JSON payload. */
  async getGscPage(args: GscPageArgs): Promise<GscPage> {
    const result = await this.callTool("get_gsc_performance", args);
    return normalizeGscPage(unwrapToolResult(result));
  }

  private async readJsonRpc(res: Response): Promise<{ result?: unknown; error?: unknown }> {
    const ct = res.headers.get("content-type") ?? "";
    const text = await res.text();
    if (ct.includes("text/event-stream") || text.includes("\ndata:") || text.startsWith("data:")) {
      // SSE: pick the first `data: {...}` line (Streamable-HTTP one-shot).
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const json = line.slice(6).trim();
          if (json && json !== "[DONE]") {
            return JSON.parse(json) as { result?: unknown; error?: unknown };
          }
        }
      }
      throw new Error(`MCP returned SSE with no parseable data line: ${text.slice(0, 300)}`);
    }
    return JSON.parse(text) as { result?: unknown; error?: unknown };
  }
}

/**
 * Some MCP servers wrap tool results in an envelope `{ content: [{type, text}],
 * structuredContent?, isError? }`. Most SEO Gets tools return data directly,
 * but we tolerate either shape. If `content[0].text` looks like JSON we parse it.
 */
export function unwrapToolResult(result: unknown): unknown {
  if (result && typeof result === "object") {
    const obj = result as {
      content?: Array<{ type?: string; text?: string }>;
      structuredContent?: unknown;
      isError?: boolean;
    };
    if (obj.structuredContent !== undefined) return obj.structuredContent;
    if (Array.isArray(obj.content)) {
      const first = obj.content[0];
      if (first?.text !== undefined) {
        const t = first.text.trim();
        if (t.startsWith("{") || t.startsWith("[")) {
          try {
            return JSON.parse(t);
          } catch {
            return first.text;
          }
        }
        return first.text;
      }
    }
  }
  return result;
}

/**
 * SEO Gets reports some application failures as successful tool results. A
 * property-scoped success echoes the requested property, including legitimate
 * empty results; failures instead return a note without that property.
 */
function assertToolResponseOk(args: Record<string, unknown>, result: unknown): void {
  if (!Object.prototype.hasOwnProperty.call(args, "property")) return;

  const unwrapped = unwrapToolResult(result);
  if (!unwrapped || typeof unwrapped !== "object" || Array.isArray(unwrapped)) return;

  const response = unwrapped as Record<string, unknown>;
  if (
    Object.prototype.hasOwnProperty.call(response, "note") &&
    !Object.prototype.hasOwnProperty.call(response, "property")
  ) {
    throw new Error(String(response.note));
  }
}
