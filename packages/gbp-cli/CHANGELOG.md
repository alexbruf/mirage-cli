# @mirage-cli/gbp-cli

## 0.2.2

### Patch Changes

- Lockstep maintenance release. No functional changes — published through the
  `publish.yml` trusted-publishing (OIDC) CI to validate the automated release
  path end-to-end.

## 0.2.1

### Patch Changes

- Packaging-only re-release. `0.2.0` was published with a direct `npm publish`,
  which bypassed `scripts/release.ts` and left the dev-only `bun` export
  condition (`"bun": "./src/index.ts"`) in the tarball — but the tarball ships
  only `dist/`, so Bun/workerd consumers hit "Cannot find module" on import.
  Re-released through `release.ts`, which strips the `bun` condition so Bun
  falls through to `dist/`. `0.2.0` is deprecated; use `>=0.2.1`.

## 0.2.0

### Minor Changes

- b8361b8: Add `@mirage-cli/gbp-cli` and its `@mirage-cli/gbp` wrapper: a Google Business
  Profile CLI (locations, performance metrics, reviews, search keywords) backed by
  the Windsor.ai `google_my_business` connector. Vendored from
  alexbruf/gbp-cli and refactored to the monorepo's side-effect-free
  `buildProgram()` shape (auth reads `WINDSOR_API_KEY`; the missing-key path throws
  instead of calling `process.exit`). Every command is fetch-only, so the program
  runs in workerd.
