---
"@mirage-cli/dataforseo-cli": patch
---

Surface DataForSEO task-level failures instead of printing an empty result and exiting 0.

DataForSEO reports failure inside an HTTP 200: the envelope says `status_code: 20000, "Ok."` and the real outcome sits per task. Neither `call` nor `get` looked below the envelope, and `extractItems` skips any task whose `result` is not an array — exactly what a failed task looks like — so `dfs serp google organic "test" --location-code 99999999` printed `[]` and exited 0 while the API had plainly said `40501: Invalid Field: 'location_code'.`

A rejected credential, an exhausted balance, a rate limit, a bad parameter and a query that legitimately had no results were therefore indistinguishable. Callers could only guess, and one guessed "unauthorized" into a client deliverable.

A shared validator now runs in both `call` and `get`, immediately after the existing HTTP check, so every command inherits it — including `--full` and `raw` — with no new flags and nothing for a caller to know. A failing envelope status is fatal. If every task failed, it throws, which the existing `bin.ts` path already turns into a non-zero exit with the message on stderr. If only some failed, it warns on stderr naming them and lets the successful rows through, since those are already paid for. A successful response with zero results still prints `[]` and exits 0.

Only `40100` (credentials rejected) and `40200`/`40210` (balance exhausted) get an added plain-English hint; every other code passes DataForSEO's own `status_message` through verbatim alongside the code. Deliberately exact rather than by numeric family — the neighbouring 401xx and 402xx codes mean rate limits, holds, subscriptions and IP policy, so a range check would mislabel them.

**Behaviour change:** calls that previously succeeded silently with an empty result now exit non-zero when the task actually failed. That is the point, but it will surface previously-hidden failures in existing pipelines.
