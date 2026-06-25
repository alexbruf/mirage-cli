import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { ApiClient } from "../client.ts";
import { requireSession } from "../config.ts";
import { type OutputOpts, writeObject } from "../output.ts";
import { stripImageMetadata } from "../strip-metadata.ts";

function client(): ApiClient {
  return new ApiClient(requireSession());
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function mimeFor(path: string): string {
  return MIME_BY_EXT[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Upload one or more files (POST /teams/:slug/files/upload, multipart). Returns
 * the created file records, each with an `id` — pass those ids to
 * `attachments create` to link them to an article (e.g. as `article_photo`).
 */
export async function uploadFiles(
  slug: string,
  paths: string[],
  folderId: string | undefined,
  stripMetadata: boolean,
  opts: OutputOpts,
): Promise<void> {
  const form = new FormData();
  for (const p of paths) {
    const raw = new Uint8Array(readFileSync(p));
    // Strip AI/EXIF/C2PA provenance metadata by default so uploaded images do
    // not advertise that they were AI-generated. Lossless; pixels untouched.
    const bytes = stripMetadata ? stripImageMetadata(raw) : raw;
    // Copy into a fresh ArrayBuffer so the Blob part is unambiguously typed.
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    form.append("files", new Blob([ab], { type: mimeFor(p) }), basename(p));
  }
  if (folderId) form.append("folder_id", folderId);
  const res = await client().multipart("POST", `/teams/${slug}/files/upload`, form);
  writeObject(res, opts);
}
