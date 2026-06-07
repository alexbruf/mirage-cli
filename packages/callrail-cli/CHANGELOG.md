# @mirage-cli/callrail-cli

## 0.1.1

### Patch Changes

- Patch release to validate the OIDC trusted-publishing pipeline (tag-driven
  GitHub Actions publish). No functional changes.

## 0.1.0

### Minor Changes

- Add `@mirage-cli/callrail-cli` and its `@mirage-cli/callrail` wrapper: a
  read-only CallRail v3 CLI (calls with transcription/summary/sentiment field
  selection, call summaries and timeseries analytics, companies, trackers, SMS
  conversations, form submissions, users, tags, integrations, plus a raw
  `callrail api` GET escape hatch). Multi-account via named profiles — one API
  key per profile, from `~/.config/callrail/config.json` (`callrail auth
add/use/list/remove`) or env (`CALLRAIL_API_KEY`, or
  `CALLRAIL_API_KEYS="name:key,..."` / JSON form selected with `--profile` /
  `CALLRAIL_PROFILE`); account ids auto-detected when a key sees exactly one.
  Output formats: json (default, full API envelope), jsonl, table, csv; `--all`
  auto-pagination capped by `--max-records`. The HTTP client is GET-only by
  construction, errors are structured JSON on stderr, and the data path is pure
  fetch so the program runs in workerd. Ships an AI workflow skill at
  `skills/callrail/SKILL.md`.
