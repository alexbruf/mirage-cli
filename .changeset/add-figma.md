---
"@mirage-cli/figma-cli": minor
"@mirage-cli/figma": minor
---

Add `@mirage-cli/figma` + `@mirage-cli/figma-cli` — a Figma CLI over the Figma REST API, self-built on a plain `fetch` client. Reads: `whoami`, `teams projects`, `projects files|meta`, `folders list|children|files|meta`, `files get|nodes|meta|versions`, `export`, `image-fills`, `components|component-sets|styles file|team|get`, `comments list|reactions`, `variables local|published`, `dev-resources list`, and an `api <path>` raw-GET escape hatch. Writes: `comments post|delete|react|unreact`, `variables post`, `dev-resources create|update|delete` — grouped under those prefixes so a host can gate them with a prefix match.

Dual credentials, because Figma's two token kinds need different headers: an OAuth 2 access token (`FIGMA_OAUTH_ACCESS_TOKEN`) is sent as `Authorization: Bearer`, a personal access token (`FIGMA_TOKEN`, aliases `FIGMA_API_KEY` / `FIGMA_PERSONAL_ACCESS_TOKEN`) as `X-Figma-Token`. OAuth wins when both are set, so a host that refreshes per call can inject only that one; `--auth-scheme` forces the header when inference is wrong.

Ergonomics aimed at LLM drivers: file arguments accept a raw key or a pasted `figma.com` URL, node ids accept both the `1:23` and `1-23` spellings, `files get` defaults to `--depth 2` (a whole Figma file is routinely tens of megabytes), `export --save <dir>` downloads the short-lived render URLs through the Mirage VFS bridge or a local filesystem, and 429s retry once on `Retry-After` and report the plan tier plus upgrade link. Lockstep 0.1.0.
