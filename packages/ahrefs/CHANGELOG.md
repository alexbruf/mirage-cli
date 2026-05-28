# @mirage-cli/ahrefs

## 0.1.10

### Patch Changes

- Republish in lockstep with `@mirage-cli/ahrefs-cli@0.1.10`, floating the
  `ahrefs-cli` peer-dependency floor to `^0.1.10`. That release carries the
  BLU-292 fix (required `date` params default to yesterday, not today, so
  site-explorer metrics stop returning 0 during the pre-publish window). No
  source change in the wrapper itself — `buildProgram` is re-exported from
  `ahrefs-cli`.
