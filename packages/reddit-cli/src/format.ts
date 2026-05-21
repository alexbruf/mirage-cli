import type { Post, PostListing, CommentChild } from "./reddit-types.ts";

export type OutputFormat = "json" | "ndjson" | "table";

type Writable = { write: (s: string) => unknown };

function postRow(p: Post["data"]): string {
  const score = String(p.score).padStart(6);
  const comments = String(p.num_comments).padStart(5);
  const title = p.title.length > 90 ? p.title.slice(0, 87) + "..." : p.title;
  return `${score} | ${comments}c | r/${p.subreddit} | ${title}  (${p.id})\n`;
}

export function emitPosts(listing: PostListing, fmt: OutputFormat, out: Writable = process.stdout) {
  if (fmt === "json") {
    out.write(JSON.stringify(listing, null, 2) + "\n");
    return;
  }
  if (fmt === "ndjson") {
    for (const c of listing.data.children) out.write(JSON.stringify(c.data) + "\n");
    return;
  }
  for (const c of listing.data.children) out.write(postRow(c.data));
}

export function emitPostsStream(
  posts: Iterable<Post>,
  fmt: OutputFormat,
  out: Writable = process.stdout,
) {
  for (const thing of posts) {
    if (fmt === "ndjson" || fmt === "json") out.write(JSON.stringify(thing.data) + "\n");
    else out.write(postRow(thing.data));
  }
}

export function emitComments(
  children: CommentChild[],
  fmt: OutputFormat,
  out: Writable = process.stdout,
  depth = 0,
) {
  if (fmt === "json") {
    out.write(JSON.stringify(children, null, 2) + "\n");
    return;
  }
  if (fmt === "ndjson") {
    const walk = (cs: CommentChild[]) => {
      for (const c of cs) {
        if (c.kind === "t1") {
          out.write(JSON.stringify(c.data) + "\n");
          if (c.data.replies && typeof c.data.replies === "object")
            walk(c.data.replies.data.children);
        } else out.write(JSON.stringify({ _kind: "more", ids: c.data.children }) + "\n");
      }
    };
    walk(children);
    return;
  }
  const indent = "  ".repeat(depth);
  for (const c of children) {
    if (c.kind === "more") {
      out.write(`${indent}[+${c.data.count} more] ${c.data.children.length} ids\n`);
      continue;
    }
    const body = c.data.body.replace(/\s+/g, " ").slice(0, 140);
    out.write(`${indent}[${c.data.score}] u/${c.data.author}: ${body}\n`);
    if (c.data.replies && typeof c.data.replies === "object")
      emitComments(c.data.replies.data.children, fmt, out, depth + 1);
  }
}
