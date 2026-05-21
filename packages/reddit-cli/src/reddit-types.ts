/**
 * Minimal subset of upstream reddit-types vendored from the reddit.viewengine.ai
 * service repo (cli/../src/lib/reddit-types.ts). Includes only the shapes the
 * CLI emits / consumes; keep in sync if upstream evolves.
 */

export type Thing<K extends string, D> = { kind: K; data: D };

export type Listing<T> = Thing<
  "Listing",
  {
    after: string | null;
    before: string | null;
    dist: number | null;
    children: T[];
    modhash?: string;
    geo_filter?: string;
  }
>;

export type Post = Thing<
  "t3",
  {
    id: string;
    name: string;
    title: string;
    author: string;
    subreddit: string;
    subreddit_id: string;
    selftext: string;
    url: string;
    permalink: string;
    score: number;
    ups: number;
    upvote_ratio: number;
    num_comments: number;
    created_utc: number;
    over_18: boolean;
    is_video: boolean;
    is_self: boolean;
    link_flair_text: string | null;
    post_hint?: string;
    domain: string;
    stickied: boolean;
    locked: boolean;
    [k: string]: unknown;
  }
>;

export type Comment = Thing<
  "t1",
  {
    id: string;
    name: string;
    author: string;
    body: string;
    body_html: string;
    score: number;
    created_utc: number;
    parent_id: string;
    link_id: string;
    depth: number;
    replies: Listing<Comment | More> | "";
    stickied: boolean;
    distinguished: string | null;
    [k: string]: unknown;
  }
>;

export type More = Thing<
  "more",
  {
    count: number;
    name: string;
    id: string;
    parent_id: string;
    depth: number;
    children: string[];
  }
>;

export type Subreddit = Thing<
  "t5",
  {
    display_name: string;
    title: string;
    public_description: string;
    subscribers: number;
    created_utc: number;
    over18: boolean;
    url: string;
    [k: string]: unknown;
  }
>;

export type User = Thing<
  "t2",
  {
    name: string;
    id: string;
    created_utc: number;
    link_karma: number;
    comment_karma: number;
    [k: string]: unknown;
  }
>;

export type PostListing = Listing<Post>;
export type CommentChild = Comment | More;
export type CommentListing = Listing<CommentChild>;
export type ThreadResponse = [PostListing, CommentListing];
