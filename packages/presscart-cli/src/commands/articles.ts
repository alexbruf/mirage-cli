import { ApiClient } from "../client.ts";
import { requireSession } from "../config.ts";
import { type OutputOpts, writeObject } from "../output.ts";

function client(): ApiClient {
  return new ApiClient(requireSession());
}

/** Get one article (GET /teams/:slug/articles/:id) — handy for review. */
export async function getArticle(
  slug: string,
  articleId: string,
  opts: OutputOpts,
): Promise<void> {
  const res = await client().request<unknown>(`/teams/${slug}/articles/${articleId}`);
  writeObject(res, opts);
}

export interface UploadOwnArticleBody {
  /** `google_doc` pairs with `google_doc_url`; `file_attachment` with `file_id`. */
  source: "google_doc" | "file_attachment";
  google_doc_url?: string;
  file_id?: string;
}

/**
 * Attach the customer's own article content to an order's auto-created article
 * (POST /teams/:slug/articles/:id/upload-own-article). For a Google Doc, share
 * it "Anyone with the link → Editor" first, then pass the doc URL.
 */
export async function uploadOwnArticle(
  slug: string,
  articleId: string,
  body: UploadOwnArticleBody,
  opts: OutputOpts,
): Promise<void> {
  const res = await client().json(
    "POST",
    `/teams/${slug}/articles/${articleId}/upload-own-article`,
    body,
  );
  writeObject(res, opts);
}

export type SubmitAction = "draft-ready-for-review" | "pending-publishing";

/**
 * Submit an article (POST /teams/:slug/articles/:id/submit). `feedback` is
 * required by the API. `draft-ready-for-review` keeps it internal; pending-publishing
 * sends it to the publisher — only do that after the order is paid and reviewed.
 */
export async function submitArticle(
  slug: string,
  articleId: string,
  action: SubmitAction,
  feedback: string,
  opts: OutputOpts,
): Promise<void> {
  const res = await client().json("POST", `/teams/${slug}/articles/${articleId}/submit`, {
    action,
    feedback,
  });
  writeObject(res, opts);
}
