# @mirage-cli/openrouter-cli

## 0.3.0

### Minor Changes

- Add `decisions` for the OpenRouter Decisions API (`POST /api/alpha/decisions`),
  used by decision models such as `typesafe/jev-1.14`: state from text, a file
  or images, questions from a JSON file, or a full request body.
- `-f text` prints one line per answer (noul, choice, score, box).
- Cost reports read the Decisions usage fields `input_tokens` / `output_tokens`.

## 0.2.0

### Minor Changes

- Add dedicated OpenRouter Images API discovery, endpoint inspection, and
  billable single-image generation.
- Require an explicit model and output path for image generation.
- Decode generated image bytes directly to local or Mirage-mounted storage and
  return a compact receipt without exposing base64 payloads on stdout.
- Support request files and reference images with bounded input and output
  memory limits.
- Preserve Cloudflare Workers runtime `fetch` binding.
