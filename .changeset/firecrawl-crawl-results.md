---
"@mirage-cli/firecrawl": minor
---

Add `firecrawl crawl-results <job-id>`: fetches every page of a crawl job (upstream `crawl <job-id>` reports status only) and prints JSON, or with `--dir` writes one markdown file per page in folders that mirror the site, plus `_index.json`. Writes go through the Mirage file bridge when the host installs one.
