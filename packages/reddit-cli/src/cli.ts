import { Command } from "commander";
import * as fs from "node:fs";
import * as API from "./client.ts";
import { emitPosts, emitPostsStream, emitComments, type OutputFormat } from "./format.ts";
import { resolveClient, updateConfig, readConfig, CONFIG_PATH } from "./config.ts";
import type { Post } from "./reddit-types.ts";

const fmtOpt = (program: Command) =>
  program
    .option("--json", "emit raw JSON")
    .option("--ndjson", "one JSON object per line")
    .option("--table", "human-readable table (default)");

function pickFmt(o: { json?: boolean; ndjson?: boolean; table?: boolean }): OutputFormat {
  if (o.json) return "json";
  if (o.ndjson) return "ndjson";
  return "table";
}

function emitGeneric(obj: unknown, fmt: OutputFormat, rowFn?: (item: unknown) => string) {
  if (fmt === "json") {
    process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
    return;
  }
  if (fmt === "ndjson") {
    if (Array.isArray(obj)) for (const x of obj) process.stdout.write(JSON.stringify(x) + "\n");
    else process.stdout.write(JSON.stringify(obj) + "\n");
    return;
  }
  if (rowFn && Array.isArray(obj)) {
    for (const x of obj) process.stdout.write(rowFn(x));
    return;
  }
  if (rowFn) {
    process.stdout.write(rowFn(obj));
    return;
  }
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

function subRow(s: {
  display_name?: string;
  subscribers?: number;
  public_description?: string;
}): string {
  const subs = String(s.subscribers ?? 0).padStart(9);
  const desc = (s.public_description ?? "").replace(/\s+/g, " ").slice(0, 80);
  return `${subs} | r/${s.display_name ?? "?"} | ${desc}\n`;
}

function userRow(u: {
  name?: string;
  link_karma?: number;
  comment_karma?: number;
  created_utc?: number;
}): string {
  const lk = String(u.link_karma ?? 0).padStart(7);
  const ck = String(u.comment_karma ?? 0).padStart(7);
  const age = u.created_utc ? new Date(u.created_utc * 1000).toISOString().slice(0, 10) : "?";
  return `u/${u.name ?? "?"} | link:${lk} comment:${ck} | since ${age}\n`;
}

async function* paginate(
  c: API.ApiClientOpts,
  sub: string,
  sort: API.SortListing,
  opts: API.ListingOpts & { pages?: number },
): AsyncGenerator<Post> {
  const pageLimit = Math.min(opts.limit ?? 100, 100);
  const maxPages = opts.pages ?? 1;
  let after = opts.after;
  for (let i = 0; i < maxPages; i++) {
    const page = await API.listing(c, sub, sort, { ...opts, limit: pageLimit, after });
    for (const child of page.data.children) yield child;
    if (!page.data.after) break;
    after = page.data.after;
  }
}

/**
 * Build the reddit Commander program. Pure function — no side effects, safe
 * to call from in-process wrappers (`@mirage-cli/reddit`) or the CLI entry
 * point below.
 */
export function buildProgram(): Command {
  const program = new Command();
  program.name("reddit").description("Reddit CLI via reddit.viewengine.ai").version("0.3.0");

  {
    const cfg = program.command("config").description("manage host/token");
    cfg.command("set-host <url>").action((url: string) => {
      updateConfig({ host: url });
      console.log(`host → ${url}`);
    });
    cfg.command("set-token <token>").action((token: string) => {
      updateConfig({ token });
      console.log("token saved");
    });
    cfg.command("show").action(() => {
      const c = readConfig();
      console.log(
        JSON.stringify(
          {
            host: c.host,
            token: c.token ? "***" : undefined,
            oauth: c.oauth
              ? {
                  issuer: c.oauth.issuer,
                  clientId: c.oauth.clientId,
                  expiresAt: new Date(c.oauth.expiresAt).toISOString(),
                }
              : undefined,
            configPath: CONFIG_PATH,
          },
          null,
          2,
        ),
      );
    });
  }

  {
    program
      .command("login")
      .description("OAuth login (PKCE, loopback)")
      .option("--issuer <url>", "issuer URL (override)")
      .option("--client-id <id>", "OAuth client_id (override)")
      .option("--port <n>", "loopback port", "53682")
      .action(async (o: { issuer?: string; clientId?: string; port: string }) => {
        const { login } = await import("./oauth.ts");
        const state = await login({
          issuer: o.issuer,
          clientId: o.clientId,
          port: Number.parseInt(o.port, 10),
        });
        console.log(
          `logged in via ${state.issuer}; token expires ${new Date(state.expiresAt).toISOString()}`,
        );
      });
    program
      .command("logout")
      .description("forget OAuth tokens")
      .action(async () => {
        const { logout } = await import("./oauth.ts");
        logout();
        console.log("logged out");
      });
  }

  for (const sort of ["hot", "new", "rising"] as const) {
    const cmd = program.command(`${sort} <sub>`).description(`/r/<sub>/${sort}`);
    fmtOpt(cmd)
      .option("-l, --limit <n>", "per-page limit (max 100)", "25")
      .option("-p, --pages <n>", "pages to paginate", "1")
      .option("--after <fullname>", "pagination cursor")
      // biome-ignore lint/suspicious/noExplicitAny: commander option bag
      .action(async (sub: string, o: any) => {
        const c = resolveClient();
        const fmt = pickFmt(o);
        const posts: Post[] = [];
        for await (const p of paginate(c, sub, sort, {
          limit: Number.parseInt(o.limit, 10),
          pages: Number.parseInt(o.pages, 10),
          after: o.after,
        }))
          posts.push(p);
        if (fmt === "json")
          process.stdout.write(JSON.stringify(posts.map((p) => p.data), null, 2) + "\n");
        else emitPostsStream(posts, fmt);
      });
  }

  for (const sort of ["top", "controversial"] as const) {
    const cmd = program.command(`${sort} <sub>`).description(`/r/<sub>/${sort} (time-filtered)`);
    fmtOpt(cmd)
      .option("-l, --limit <n>", "per-page limit (max 100)", "25")
      .option("-p, --pages <n>", "pages to paginate", "1")
      .option("--after <fullname>", "pagination cursor")
      .option("-t, --t <w>", "hour|day|week|month|year|all", "day")
      // biome-ignore lint/suspicious/noExplicitAny: commander option bag
      .action(async (sub: string, o: any) => {
        const c = resolveClient();
        const fmt = pickFmt(o);
        const posts: Post[] = [];
        for await (const p of paginate(c, sub, sort, {
          limit: Number.parseInt(o.limit, 10),
          pages: Number.parseInt(o.pages, 10),
          after: o.after,
          t: o.t,
        }))
          posts.push(p);
        if (fmt === "json")
          process.stdout.write(JSON.stringify(posts.map((p) => p.data), null, 2) + "\n");
        else emitPostsStream(posts, fmt);
      });
  }

  {
    const cmd = program
      .command("frontpage [sort]")
      .description("logged-out frontpage (hot|new|rising|top|controversial)");
    fmtOpt(cmd)
      .option("-l, --limit <n>", "limit", "25")
      .option("-t, --t <w>", "hour|day|week|month|year|all (top/controversial)")
      // biome-ignore lint/suspicious/noExplicitAny: commander option bag
      .action(async (sort: string | undefined, o: any) => {
        const c = resolveClient();
        const s = (sort ?? "hot") as API.SortListing;
        const l = await API.listing(c, "", s, { limit: Number.parseInt(o.limit, 10), t: o.t });
        emitPosts(l, pickFmt(o));
      });
  }

  {
    const cmd = program.command("post <id>").description("post + comments");
    fmtOpt(cmd)
      .option("-s, --sort <s>", "confidence|top|new|controversial|old|qa", "confidence")
      .option("-d, --depth <n>", "comment depth")
      .option("-l, --limit <n>", "comment count limit")
      .option("--expand-more", "resolve 'more' stubs")
      .option("--sub <name>", "subreddit (optional)")
      // biome-ignore lint/suspicious/noExplicitAny: commander option bag
      .action(async (id: string, o: any) => {
        const c = resolveClient();
        const [postListing, commentListing] = await API.thread(c, id, {
          sort: o.sort,
          depth: o.depth ? Number.parseInt(o.depth, 10) : undefined,
          limit: o.limit ? Number.parseInt(o.limit, 10) : undefined,
          sub: o.sub,
          expandMore: !!o.expandMore,
        });
        const fmt = pickFmt(o);
        if (fmt === "json") {
          process.stdout.write(
            JSON.stringify(
              { post: postListing.data.children[0]?.data, comments: commentListing },
              null,
              2,
            ) + "\n",
          );
        } else {
          const p = postListing.data.children[0]?.data;
          if (p)
            process.stdout.write(
              `# ${p.title}\n  r/${p.subreddit} · u/${p.author} · ${p.score} · ${p.num_comments}c · ${p.permalink}\n\n`,
            );
          emitComments(commentListing.data.children, fmt);
        }
      });
  }

  {
    const cmd = program.command("search <query>").description("search posts (or subs/users)");
    fmtOpt(cmd)
      .option("--sub <name>", "restrict to subreddit")
      .option("-s, --sort <s>", "relevance|new|hot|top|comments", "relevance")
      .option("-t, --t <w>", "hour|day|week|month|year|all")
      .option("--type <t>", "link|sr|user", "link")
      .option("-l, --limit <n>", "limit", "25")
      .option("--after <fullname>", "cursor")
      // biome-ignore lint/suspicious/noExplicitAny: commander option bag
      .action(async (q: string, o: any) => {
        const c = resolveClient();
        const res = await API.search(c, q, {
          sub: o.sub,
          sort: o.sort,
          t: o.t,
          type: o.type,
          limit: Number.parseInt(o.limit, 10),
          after: o.after,
          restrictSr: !!o.sub,
        });
        emitPosts(res, pickFmt(o));
      });
  }

  {
    const about = program.command("about").description("about sub/user");
    const sub = about.command("sub <name>");
    // biome-ignore lint/suspicious/noExplicitAny: commander option bag
    fmtOpt(sub).action(async (name: string, o: any) => {
      const c = resolveClient();
      const r = await API.aboutSub(c, name);
      // biome-ignore lint/suspicious/noExplicitAny: subreddit data is open-ended
      emitGeneric(r.data, pickFmt(o), (x: any) => subRow(x));
    });
    const user = about.command("user <name>");
    // biome-ignore lint/suspicious/noExplicitAny: commander option bag
    fmtOpt(user).action(async (name: string, o: any) => {
      const c = resolveClient();
      const r = await API.aboutUser(c, name);
      // biome-ignore lint/suspicious/noExplicitAny: user data is open-ended
      emitGeneric(r.data, pickFmt(o), (x: any) => userRow(x));
    });
  }

  {
    const user = program.command("user").description("user submissions/comments");
    const sub = user.command("submitted <name>");
    fmtOpt(sub)
      .option("-l, --limit <n>", "limit", "25")
      .option("-s, --sort <s>", "new|hot|top|controversial", "new")
      // biome-ignore lint/suspicious/noExplicitAny: commander option bag
      .action(async (name: string, o: any) => {
        const c = resolveClient();
        const r = await API.userPosts(c, name, "submitted", {
          limit: Number.parseInt(o.limit, 10),
          sort: o.sort,
        });
        emitGeneric(r, pickFmt(o));
      });
    const com = user.command("comments <name>");
    fmtOpt(com)
      .option("-l, --limit <n>", "limit", "25")
      .option("-s, --sort <s>", "new|hot|top|controversial", "new")
      // biome-ignore lint/suspicious/noExplicitAny: commander option bag
      .action(async (name: string, o: any) => {
        const c = resolveClient();
        const r = await API.userPosts(c, name, "comments", {
          limit: Number.parseInt(o.limit, 10),
          sort: o.sort,
        });
        emitGeneric(r, pickFmt(o));
      });
  }

  {
    const subs = program.command("subs").description("subreddit discovery");
    for (const kind of ["popular", "new", "default", "premium"] as const) {
      const sub = subs.command(kind);
      fmtOpt(sub)
        .option("-l, --limit <n>", "limit", "25")
        // biome-ignore lint/suspicious/noExplicitAny: commander option bag
        .action(async (o: any) => {
          const c = resolveClient();
          const r = await API.subreddits(c, kind, { limit: Number.parseInt(o.limit, 10) });
          // biome-ignore lint/suspicious/noExplicitAny: subreddit data is open-ended
          emitGeneric(r.data.children.map((c) => c.data), pickFmt(o), (x: any) => subRow(x));
        });
    }
    const srch = subs.command("search <q>");
    fmtOpt(srch)
      .option("-l, --limit <n>", "limit", "25")
      // biome-ignore lint/suspicious/noExplicitAny: commander option bag
      .action(async (q: string, o: any) => {
        const c = resolveClient();
        const r = await API.searchSubs(c, q, { limit: Number.parseInt(o.limit, 10) });
        // biome-ignore lint/suspicious/noExplicitAny: subreddit data is open-ended
        emitGeneric(r.data.children.map((c) => c.data), pickFmt(o), (x: any) => subRow(x));
      });
  }

  {
    const cmd = program
      .command("bulk")
      .description("batch up to 25 ops (JSON array on stdin or --file)");
    fmtOpt(cmd)
      .option("-f, --file <path>", "read items from file instead of stdin")
      // biome-ignore lint/suspicious/noExplicitAny: commander option bag
      .action(async (o: any) => {
        const raw = o.file
          ? fs.readFileSync(o.file, "utf8")
          : await new Promise<string>((resolve, reject) => {
              let buf = "";
              process.stdin.setEncoding("utf8");
              process.stdin.on("data", (d) => {
                buf += d;
              });
              process.stdin.on("end", () => resolve(buf));
              process.stdin.on("error", reject);
            });
        const parsed = JSON.parse(raw);
        const items = Array.isArray(parsed) ? parsed : parsed.items;
        if (!Array.isArray(items))
          throw new Error("bulk input must be a JSON array or { items: [...] }");
        const c = resolveClient();
        const r = await API.bulk(c, items);
        emitGeneric(r, pickFmt(o));
      });
  }

  {
    const cmd = program.command("job <id>").description("poll a bulk/expand-more job by id");
    // biome-ignore lint/suspicious/noExplicitAny: commander option bag
    fmtOpt(cmd).action(async (id: string, o: any) => {
      const c = resolveClient();
      const r = await API.job(c, id);
      emitGeneric(r, pickFmt(o));
    });
  }

  {
    const cmd = program.command("me").description("account + credit balance");
    // biome-ignore lint/suspicious/noExplicitAny: commander option bag
    fmtOpt(cmd).action(async (o: any) => {
      const r = await API.me(resolveClient());
      const fmt = pickFmt(o);
      if (fmt === "json" || fmt === "ndjson")
        process.stdout.write(JSON.stringify(r) + "\n");
      else process.stdout.write(`user: ${r.user_id}\ncredits: ${r.credits}\n`);
    });
  }

  return program;
}
