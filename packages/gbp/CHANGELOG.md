# @mirage-cli/gbp

## 0.2.2

### Patch Changes

- Lockstep maintenance release. No functional changes — first publish of
  `@mirage-cli/gbp` through the `publish.yml` trusted-publishing (OIDC) CI,
  validating the automated release path.
- Updated dependencies
  - @mirage-cli/gbp-cli@0.2.2

## 0.2.1

### Minor Changes

- Initial release of the `@mirage-cli/gbp` wrapper: a Google Business Profile
  CLI (locations, performance metrics, reviews, search keywords) backed by the
  Windsor.ai `google_my_business` connector, surfaced as `buildProgram` +
  `gbpCommand` + `gbpResource` for mirage / Cloudflare-Worker consumption. Auth
  reads `WINDSOR_API_KEY`; the missing-key path throws instead of calling
  `process.exit`. Every command is fetch-only, so the program runs in workerd.
  Versioned in lockstep with `@mirage-cli/gbp-cli@0.2.1`.

### Patch Changes

- Updated dependencies
  - @mirage-cli/gbp-cli@0.2.1
