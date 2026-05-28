---
"@mirage-cli/gbp-cli": minor
"@mirage-cli/gbp": minor
---

Add `@mirage-cli/gbp-cli` and its `@mirage-cli/gbp` wrapper: a Google Business
Profile CLI (locations, performance metrics, reviews, search keywords) backed by
the Windsor.ai `google_my_business` connector. Vendored from
alexbruf/gbp-cli and refactored to the monorepo's side-effect-free
`buildProgram()` shape (auth reads `WINDSOR_API_KEY`; the missing-key path throws
instead of calling `process.exit`). Every command is fetch-only, so the program
runs in workerd.
