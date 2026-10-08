import { writeBytes } from "./fileio.ts";

/**
 * Download Mobbin's high-resolution images. `image_url` is a public short link
 * (it redirects to Mobbin's image CDN without auth) that expires after 30 days,
 * so saving the file is the only durable way to keep a reference.
 */

const CONCURRENCY = 6;

export function slug(value: string | undefined, max = 40): string {
  const s = (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
  return s || "item";
}

function extFor(contentType: string | null, fallback: string): string {
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("jpeg") || contentType?.includes("jpg")) return "jpg";
  if (contentType?.includes("webp")) return "webp";
  return fallback;
}

/** Fetch one image and write it to `pathWithoutExt` plus the served extension. */
export async function downloadImage(url: string, pathWithoutExt: string, fallbackExt = "webp"): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image download failed: ${res.status} ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const path = `${pathWithoutExt}.${extFor(res.headers.get("content-type"), fallbackExt)}`;
  await writeBytes(path, bytes);
  return path;
}

export interface SaveJob {
  url: string;
  pathWithoutExt: string;
  /** Receives the written path. */
  done: (path: string) => void;
}

/** Run downloads a few at a time; one failed image does not stop the rest. */
export async function runSaves(jobs: SaveJob[], fallbackExt: string): Promise<string[]> {
  const failures: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++] as SaveJob;
      try {
        job.done(await downloadImage(job.url, job.pathWithoutExt, fallbackExt));
      } catch (e) {
        failures.push((e as Error).message);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  return failures;
}

export const joinPath = (dir: string, name: string): string => `${dir.replace(/\/+$/, "")}/${name}`;
