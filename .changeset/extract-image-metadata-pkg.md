---
"@mirage-cli/image": minor
"@mirage-cli/presscart-cli": patch
---

Extract the image provenance-metadata stripper into a new general-purpose `@mirage-cli/image` package (pure-JS, Worker-safe: strips EXIF/XMP/C2PA from JPEG/PNG/WebP without re-encoding). Stripping image metadata isn't presscart-specific, so it no longer lives inside presscart-cli; `presscart-cli` now consumes `stripImageMetadata` from `@mirage-cli/image`. No behaviour change to `files upload --strip-metadata`.
