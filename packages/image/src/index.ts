/**
 * @mirage-cli/image — pure-JS, Cloudflare Worker-safe image utilities.
 *
 * `stripImageMetadata` removes EXIF/XMP and C2PA "Content Credentials"
 * provenance from JPEG/PNG/WebP at the byte level (lossless, no re-encode, no
 * WASM). General-purpose: useful anywhere images are handled, not tied to any
 * one vendor CLI.
 */
export { isJpeg, isPng, isWebp, stripImageMetadata } from "./strip-metadata.ts";
