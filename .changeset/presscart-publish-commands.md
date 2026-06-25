---
"@mirage-cli/presscart-cli": minor
"@mirage-cli/presscart": minor
---

Add the team-scoped publishing commands so the full self-submitted-story flow can run from the CLI. New: `teams list` (resolve the `:slug` the publishing endpoints need), `articles get|upload-own-article|submit`, `files upload` (multipart, the first multipart support in the client), `attachments create`, and `campaigns upload-content`. Together with the existing `orders checkout`/`orders items` these cover: create order → resolve the auto-created article id → attach a Google Doc (`--source google_doc --google-doc-url`) → upload images and link them as `article_photo` → submit. Payment is intentionally left to the app (checkout returns a `CREATED`/Stripe order unless covered by Team Credits).

`files upload` strips image provenance metadata (EXIF/XMP and C2PA Content Credentials, the "made by ChatGPT/Gemini" markers) by default via a pure-JS, workerd-safe byte-level strip for JPEG/PNG/WebP — lossless, pixels untouched; `--no-strip-metadata` opts out. (Invisible in-pixel watermarks like SynthID are not metadata and are out of scope.) Input is validated before hitting the API: `upload-own-article` requires the field matching `--source`, `campaigns upload-content` requires a `--campaign-id` or `--campaign-name` (every placement must belong to a campaign), and `attachments create` enforces the 1..50 file-id limit.
