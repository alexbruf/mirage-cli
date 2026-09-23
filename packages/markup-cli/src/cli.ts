import { Command, Option } from "commander";
import { type ApiClientOpts, callTool, listTools, resolveClient, TOOL } from "./client.ts";
import { configPath, DEFAULT_HOST, readConfig, resolveHost, updateConfig } from "./config.ts";
import { emit, type OutputFormat, pickFmt } from "./format.ts";

export const VERSION = "0.1.0";

type FmtOpts = { json?: boolean; ndjson?: boolean };

const withFmt = (cmd: Command) =>
  cmd.option("--json", "emit raw JSON").option("--ndjson", "one JSON object per line");

/** `"12,40,200,24"` → a selection rectangle. */
export function parseRect(value: string, previous: Rect[] = []): Rect[] {
  const parts = value.split(",").map((n) => Number(n.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`--rect takes x,y,width,height (got "${value}")`);
  }
  const [x, y, width, height] = parts as [number, number, number, number];
  return [...previous, { x, y, width, height }];
}
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Drop undefined so optional flags are simply absent from the tool call. */
const defined = (obj: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

const PRIORITY = new Option("--priority <level>", "annotation priority").choices(["low", "medium", "high", "urgent"]);

/**
 * Build the markup Commander program. Pure — no side effects on import — so the
 * `@mirage-cli/markup` wrapper can run it in-process.
 *
 * Commands that change a board (`comment`, `suggest`, `ack`, `reply`,
 * `resolve`, `dismiss`, `create`) are plain top-level names, and every read is
 * too; `markup tools` lists the server's tools for anything not covered here.
 */
export function buildProgram(): Command {
  const program = new Command();
  program
    .name("markup")
    .description(`ViewEngine Markup CLI: boards and annotations on ${DEFAULT_HOST}`)
    .version(VERSION)
    .option("--host <url>", "Markup deployment (default: MARKUP_HOST, saved host, or markup.viewengine.dev)")
    .hook("preAction", (cmd) => {
      const host = cmd.opts<{ host?: string }>().host;
      if (host) process.env.MARKUP_HOST = host;
    });

  const run = async (fn: (c: ApiClientOpts) => Promise<unknown>, fmt: OutputFormat, row?: (x: unknown) => string) =>
    emit(await fn(await resolveClient()), fmt, row);

  // ── session ─────────────────────────────────────────────────────────────
  program
    .command("login")
    .description("sign in through the browser (OAuth + PKCE); lasts until `markup logout`")
    .option("--port <n>", "loopback port for the callback", "53683")
    .option("--client-id <url>", "OAuth client_id override (default: <host>/cli/oauth-client.json)")
    .option("--no-browser", "print the sign-in URL instead of opening it")
    .action(async (o: { port: string; clientId?: string; browser: boolean }) => {
      const { login } = await import("./oauth.ts");
      const state = await login({
        host: resolveHost(),
        clientId: o.clientId,
        port: Number.parseInt(o.port, 10),
        noBrowser: !o.browser,
      });
      console.log(`signed in to ${state.issuer}`);
    });

  program
    .command("logout")
    .description("revoke the session on the server and forget it locally")
    .action(async () => {
      const { logout } = await import("./oauth.ts");
      const { revoked } = await logout();
      console.log(revoked ? "logged out (session revoked)" : "logged out locally");
    });

  program
    .command("status")
    .description("show the host and whether you are signed in")
    .action(() => {
      const cfg = readConfig();
      const out = {
        host: resolveHost(),
        signedIn: Boolean(cfg.oauth) || Boolean(process.env.MARKUP_TOKEN),
        via: process.env.MARKUP_TOKEN ? "MARKUP_TOKEN" : cfg.oauth ? "markup login" : null,
        mcpUrl: `${resolveHost()}/mcp`,
        configPath: configPath,
      };
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    });

  program
    .command("set-host <url>")
    .description("save a different Markup deployment as the default")
    .action((url: string) => {
      updateConfig({ host: url.replace(/\/$/, "") });
      console.log(`host → ${url}`);
    });

  // ── boards ──────────────────────────────────────────────────────────────
  withFmt(program.command("boards").description("list the boards saved to your account")).action((o: FmtOpts) =>
    run((c) => callTool(c, TOOL.listBoards), pickFmt(o), (b) => {
      const x = b as { link: string; url: string | null; access: string };
      return `${x.link}  ${x.url ?? "(no page)"}${x.access === "view" ? "  [view only]" : ""}\n`;
    }),
  );

  withFmt(program.command("create <url>").description("open a new board on a page and save it to your account")).action(
    (url: string, o: FmtOpts) =>
      run((c) => callTool(c, TOOL.createBoard, { url }), pickFmt(o), (b) => `${(b as { link: string }).link}\n`),
  );

  withFmt(program.command("info <board>").description("board facts: page URL, width, created, expiry")).action(
    (room: string, o: FmtOpts) => run((c) => callTool(c, TOOL.roomInfo, { room }), pickFmt(o)),
  );

  withFmt(program.command("page <board>").description("outline of the page the board annotates (selectors + text)")).action(
    (room: string, o: FmtOpts) => run((c) => callTool(c, TOOL.readPage, { room }), pickFmt(o)),
  );

  // ── annotations: read ──────────────────────────────────────────────────
  const annotationRow = (a: unknown) => {
    const x = a as { id: string; status: string; kind: string; text?: string; comment?: string };
    const text = (x.text ?? x.comment ?? "").replace(/\s+/g, " ").slice(0, 90);
    return `${x.id}  ${x.status.padEnd(11)} ${x.kind.padEnd(9)} ${text}\n`;
  };

  withFmt(
    program
      .command("list <board>")
      .description("list annotations on a board")
      .addOption(
        new Option("--status <status>", "filter by status").choices([
          "open",
          "in_progress",
          "resolved",
          "approved",
          "dismissed",
          "all",
        ]),
      ),
  ).action((room: string, o: FmtOpts & { status?: string }) =>
    run(
      async (c) =>
        (await callTool<{ annotations: unknown[] }>(c, TOOL.list, defined({ room, status: o.status }))).annotations,
      pickFmt(o),
      annotationRow,
    ),
  );

  withFmt(program.command("get <board> <id>").description("one annotation, with its thread and target element")).action(
    (room: string, id: string, o: FmtOpts) => run((c) => callTool(c, TOOL.get, { room, id }), pickFmt(o)),
  );

  withFmt(
    program
      .command("watch <board>")
      .description("wait for new or changed annotations; --follow keeps watching")
      .option("--timeout <seconds>", "how long one wait lasts", "60")
      .option("--follow", "loop forever, printing events as they arrive"),
  ).action(async (room: string, o: FmtOpts & { timeout: string; follow?: boolean }) => {
    const c = await resolveClient();
    const fmt = pickFmt(o);
    do {
      const r = await callTool<{ events: unknown[] }>(c, TOOL.watch, {
        room,
        timeoutSeconds: Number.parseInt(o.timeout, 10),
      });
      if (r.events.length || !o.follow) emit(o.follow ? r.events : r, o.follow && fmt === "table" ? "ndjson" : fmt);
    } while (o.follow);
  });

  // ── annotations: write ─────────────────────────────────────────────────
  withFmt(
    program
      .command("comment <board> <text>")
      .description("pin a comment on the page at x,y (page pixels)")
      .requiredOption("--x <n>", "x position", Number)
      .requiredOption("--y <n>", "y position", Number)
      .addOption(PRIORITY)
      .option("--selector <css>", "target element (needs --tag and --markdown too)")
      .option("--tag <tag>", "target element tag")
      .option("--markdown <md>", "target element snapshot"),
  ).action(
    (
      room: string,
      text: string,
      o: FmtOpts & { x: number; y: number; priority?: string; selector?: string; tag?: string; markdown?: string },
    ) =>
      run(
        (c) =>
          callTool(
            c,
            TOOL.create,
            defined({ room, text, x: o.x, y: o.y, priority: o.priority, selector: o.selector, tag: o.tag, markdown: o.markdown }),
          ),
        pickFmt(o),
      ),
  );

  withFmt(
    program
      .command("suggest <board> <text> <replacement>")
      .description("suggest replacing some text on the page")
      .requiredOption("--rect <x,y,w,h>", "where the text is (repeatable)", parseRect)
      .option("--comment <text>", "why")
      .addOption(PRIORITY),
  ).action(
    (room: string, text: string, suggestion: string, o: FmtOpts & { rect: Rect[]; comment?: string; priority?: string }) =>
      run(
        (c) =>
          callTool(c, TOOL.suggest, defined({ room, text, suggestion, rects: o.rect, comment: o.comment, priority: o.priority })),
        pickFmt(o),
      ),
  );

  withFmt(program.command("ack <board> <id>").description("mark an annotation in progress")).action(
    (room: string, id: string, o: FmtOpts) => run((c) => callTool(c, TOOL.acknowledge, { room, id }), pickFmt(o)),
  );

  withFmt(program.command("reply <board> <id> <text>").description("reply in an annotation's thread")).action(
    (room: string, id: string, text: string, o: FmtOpts) => run((c) => callTool(c, TOOL.reply, { room, id, text }), pickFmt(o)),
  );

  withFmt(
    program.command("resolve <board> <id>").description("mark an annotation resolved").option("--summary <text>", "what was done"),
  ).action((room: string, id: string, o: FmtOpts & { summary?: string }) =>
    run((c) => callTool(c, TOOL.resolve, defined({ room, id, summary: o.summary })), pickFmt(o)),
  );

  withFmt(program.command("dismiss <board> <id> <reason>").description("close an annotation without acting on it")).action(
    (room: string, id: string, reason: string, o: FmtOpts) => run((c) => callTool(c, TOOL.dismiss, { room, id, reason }), pickFmt(o)),
  );

  // ── escape hatches ─────────────────────────────────────────────────────
  withFmt(program.command("tools").description("list the MCP tools the server exposes")).action((o: FmtOpts) =>
    run(listTools, pickFmt(o), (t) => `${(t as { name: string }).name}\n`),
  );

  withFmt(
    program
      .command("call <tool> [json]")
      .description("call any MCP tool with a JSON object of arguments"),
  ).action((tool: string, json: string | undefined, o: FmtOpts) =>
    run((c) => callTool(c, tool, json ? (JSON.parse(json) as Record<string, unknown>) : {}), pickFmt(o)),
  );

  return program;
}
