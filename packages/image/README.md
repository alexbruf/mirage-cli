# @mirage-cli/image

Pure-JS, Cloudflare Worker-safe image utilities. No native deps, no WASM, no
image codec.

## `stripImageMetadata(bytes)`

Removes EXIF, XMP, and C2PA "Content Credentials" (the readable/cryptographic
"made by ChatGPT/Gemini" provenance) from **JPEG, PNG, and WebP**. It walks the
container and drops the metadata segments/chunks at the byte level, leaving the
pixel data byte-for-byte intact — **lossless, no re-encode**. Any other/unknown
format is returned unchanged.

```ts
import { stripImageMetadata } from "@mirage-cli/image";

const clean = stripImageMetadata(new Uint8Array(await file.arrayBuffer()));
```

It does **not** remove invisible in-pixel watermarks such as Google SynthID —
those are not metadata and survive any strip; removing them is out of scope.

Also exported: `isJpeg`, `isPng`, `isWebp` (magic-byte detectors).
