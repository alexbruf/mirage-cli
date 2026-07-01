---
"@mirage-cli/radar-cli": patch
---

Drop the client-side `--org <slug>` resolution probe. The org-scoped V1 API now
resolves the `X-Active-Org-Id` header by id **or** slug server-side
(visibility-tool PR #51), so `--org` is passed through verbatim — removing the
extra `/v1/orgs` round-trip on every `--org <slug>` call (added in 0.2.1/0.2.2 as
a workaround) and the brittle `org_`-prefix heuristic.

Also surfaces agency **shared projects**: `projects`/`queries`/`results`/`game-plans`
scoped to the active org now include projects shared into it, each project row
tagged with an `access: "owner" | "shared"` field. Docs updated; no CLI flag
changes.
