import { configPath, type OAuthState, readConfig, resolveMcpUrl } from "./config.ts";

/**
 * Calls Mobbin's MCP endpoint (`https://api.mobbin.com/mcp`) over plain HTTP.
 * The server is stateless Streamable HTTP (no session id is issued), so one
 * tool call is one POST with no `initialize` handshake to keep.
 */

export interface ApiClientOpts {
  url: string;
  /** Bearer access token. */
  token: string;
  /** Returns a fresh access token after a 401, or null when it cannot. */
  onRefresh?: () => Promise<string | null>;
}

export class MobbinError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MobbinError";
  }
}

/** Refresh this long before the access token actually expires. */
const REFRESH_SKEW_MS = 60_000;

/**
 * Credentials in precedence order:
 *   1. `MOBBIN_ACCESS_TOKEN` — an access token a host injects per call (no refresh).
 *   2. The saved `mobbin login` session, refreshed silently as needed.
 */
export async function resolveClient(): Promise<ApiClientOpts> {
  const url = resolveMcpUrl();
  const envToken = process.env.MOBBIN_ACCESS_TOKEN?.trim();
  if (envToken) return { url, token: envToken };

  const saved = readConfig().oauth;
  if (!saved) {
    throw new MobbinError(
      `not signed in. Run \`mobbin login\` (config: ${configPath()}) or set MOBBIN_ACCESS_TOKEN.`,
    );
  }
  const { refresh } = await import("./oauth.ts");
  let current: OAuthState = saved;
  if (current.expiresAt - REFRESH_SKEW_MS < Date.now()) current = await refresh(current);
  return {
    url,
    token: current.accessToken,
    onRefresh: async () => {
      const latest = readConfig().oauth;
      if (!latest) return null;
      return (await refresh(latest)).accessToken;
    },
  };
}

/** A Streamable HTTP reply is either JSON or an SSE stream; take the JSON-RPC message from either. */
export function parseRpcBody(body: string): unknown {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const data = trimmed
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean)
    .at(-1);
  if (!data) throw new MobbinError("empty response from the MCP endpoint");
  return JSON.parse(data);
}

export interface ContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface ToolResult {
  content?: ContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

interface RpcReply {
  result?: ToolResult;
  error?: { code: number; message: string };
}

let rpcId = 0;

async function rpc(opts: ApiClientOpts, method: string, params: unknown): Promise<RpcReply> {
  const send = (token: string) =>
    fetch(opts.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    });
  let res = await send(opts.token);
  if (res.status === 401 && opts.onRefresh) {
    const fresh = await opts.onRefresh();
    if (fresh) {
      opts.token = fresh;
      res = await send(fresh);
    }
  }
  if (res.status === 401) {
    throw new MobbinError("Mobbin session expired or revoked. Run `mobbin login` (or reconnect the mount).", 401);
  }
  if (res.status === 403) {
    throw new MobbinError("Mobbin refused the call (403). MCP access needs a Pro, Team or Enterprise plan.", 403);
  }
  const body = await res.text();
  if (!res.ok) throw new MobbinError(`${res.status} ${body.slice(0, 300)}`, res.status);
  return parseRpcBody(body) as RpcReply;
}

/**
 * Call one MCP tool and return the raw result: `structuredContent` (the
 * machine-readable answer) plus `content` (a JSON text block and, for search
 * tools, low-res inline webp previews). A tool-level error becomes a thrown
 * MobbinError carrying the server's message.
 */
export async function callTool(
  opts: ApiClientOpts,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  const reply = await rpc(opts, "tools/call", { name, arguments: args });
  if (reply.error) throw new MobbinError(reply.error.message);
  const result = reply.result ?? {};
  if (result.isError) {
    const text = (result.content ?? [])
      .map((block) => block.text ?? "")
      .join("\n")
      .trim();
    throw new MobbinError(text || `${name} failed`);
  }
  return result;
}

/**
 * The machine-readable answer of a tool result. Mobbin fills
 * `structuredContent`; the first JSON text block is the fallback for a server
 * that stops sending it.
 */
export function structured<T = Record<string, unknown>>(result: ToolResult): T {
  if (result.structuredContent) return result.structuredContent as T;
  for (const block of result.content ?? []) {
    if (block.type !== "text" || !block.text) continue;
    try {
      return JSON.parse(block.text) as T;
    } catch {
      // Not JSON; keep looking.
    }
  }
  throw new MobbinError("the tool returned no structured result");
}

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export async function listTools(opts: ApiClientOpts): Promise<ToolInfo[]> {
  const reply = await rpc(opts, "tools/list", {});
  if (reply.error) throw new MobbinError(reply.error.message);
  return ((reply.result as unknown as { tools?: ToolInfo[] })?.tools ?? []) as ToolInfo[];
}

/** Tool names on the server. The search commands map onto these one-to-one. */
export const TOOL = {
  screens: "search_screens",
  flows: "search_flows",
  sections: "search_sections",
} as const;
