---
"@mirage-cli/ve-fanout": minor
"@mirage-cli/ve-fanout-cli": minor
---

Add VE Fanout CLI: query fan-out for AI visibility via the VE Fanout v1 API. Read commands (`queries list|get|watch`, `engines list`, `credits`, `status`, `orgs`, `whoami`) surface how ChatGPT, Gemini (AI Overviews/AI Mode), and Perplexity decompose a query; `queries create`/`regenerate`/`run-engine` submit fan-out work (billable) and `queries delete` is destructive. Auth via `VE_FANOUT_TOKEN` (or interactive `ve-fanout login`). Token-based read calls are workerd-safe; exposes `buildProgram()` + `veFanoutResource` for mirage runtimes.
