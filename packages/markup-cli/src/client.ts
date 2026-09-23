import { configPath, type OAuthState, readConfig, resolveHost } from "./config.ts";

/**
 * Calls the account-wide Markup MCP endpoint (`<host>/mcp`) over plain HTTP.
 * The server is stateless Streamable HTTP, so one tool call is one POST — no
 * session, no `initialize` handshake to keep.
 */

export interface ApiClientOpts {
  host: string;
  /** Bearer access token. */
  token: string;
  /** Returns a fresh access token after a 401, or null when it cannot. */
  onRefresh?: () => Promise<string | null>;
  /** Shown to people watching the board. Defaults to "markup-cli". */
  agent?: string;
}

export class MarkupError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MarkupError";
  }
}

/** Refresh this long before the access token actually expires. */
const REFRESH_SKEW_MS = 60_000;

/**
 * Credentials in precedence order:
 *   1. `MARKUP_TOKEN` — an access token a host injects per call (no refresh).
 *   2. The saved `markup login` session, refreshed silently as needed.
 */
export async function resolveClient(): Promise<ApiClientOpts> {
  const host = resolveHost();
  const envToken = process.env.MARKUP_TOKEN;
  if (envToken) return { host, token: envToken };

  const saved = readConfig().oauth;
  if (!saved) {
    throw new MarkupError(`not signed in. Run \`markup login\` (config: ${configPath()}) or set MARKUP_TOKEN.`);
  }
  if (saved.issuer !== host) {
    throw new MarkupError(`signed in to ${saved.issuer}, not ${host}. Run \`markup login\` again.`);
  }
  const { refresh } = await import("./oauth.ts");
  let current: OAuthState = saved;
  if (current.expiresAt - REFRESH_SKEW_MS < Date.now()) current = await refresh(current);
  return {
    host,
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
  if (!data) throw new MarkupError("empty response from the MCP endpoint");
  return JSON.parse(data);
}

interface RpcReply {
  result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean };
  error?: { code: number; message: string };
}

let rpcId = 0;

async function rpc(opts: ApiClientOpts, method: string, params: unknown): Promise<RpcReply> {
  const url = new URL(`${opts.host}/mcp`);
  url.searchParams.set("agent", opts.agent ?? "markup-cli");
  const send = (token: string) =>
    fetch(url, {
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
  if (res.status === 401) throw new MarkupError("session expired or revoked. Run `markup login`.", 401);
  const body = await res.text();
  if (!res.ok) throw new MarkupError(`${res.status} ${body.slice(0, 300)}`, res.status);
  return parseRpcBody(body) as RpcReply;
}

/**
 * Call one MCP tool and return its result. Tools answer with one JSON text
 * block; that is parsed, and a tool-level error becomes a thrown MarkupError.
 */
export async function callTool<T = unknown>(
  opts: ApiClientOpts,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const reply = await rpc(opts, "tools/call", { name, arguments: args });
  if (reply.error) throw new MarkupError(reply.error.message);
  const text = (reply.result?.content ?? [])
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
  let value: unknown = text;
  try {
    value = JSON.parse(text);
  } catch {
    // Some errors are plain sentences; keep them as text.
  }
  if (reply.result?.isError) {
    const message =
      value && typeof value === "object" && "error" in value ? String((value as { error: unknown }).error) : text;
    throw new MarkupError(message);
  }
  return value as T;
}

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export async function listTools(opts: ApiClientOpts): Promise<ToolInfo[]> {
  const reply = await rpc(opts, "tools/list", {});
  if (reply.error) throw new MarkupError(reply.error.message);
  return ((reply.result as unknown as { tools?: ToolInfo[] })?.tools ?? []) as ToolInfo[];
}

/** Tool names on the server. The CLI's commands map onto these one-to-one. */
export const TOOL = {
  listBoards: "markup_list_boards",
  createBoard: "markup_create_board",
  roomInfo: "markup_room_info",
  readPage: "markup_read_page",
  list: "markup_list_annotations",
  get: "markup_get_annotation",
  watch: "markup_watch_annotations",
  acknowledge: "markup_acknowledge",
  resolve: "markup_resolve",
  dismiss: "markup_dismiss",
  reply: "markup_reply",
  create: "markup_create_annotation",
  suggest: "markup_suggest_edit",
} as const;
