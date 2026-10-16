---
"@mirage-cli/firecrawl": minor
---

Add `firecrawl scrape-many <urls...> --dir <path>` (and `--urls-file`, e.g. saved `map` output): scrapes each URL and writes one markdown file per page in folders that mirror the site, plus `_index.json` listing pages and failures. Upstream multi-URL `scrape` saves into a hard-coded local `.firecrawl/` folder.
