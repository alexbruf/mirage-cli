# @mirage-cli/openrouter-cli

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
