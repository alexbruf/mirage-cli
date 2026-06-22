---
"@mirage-cli/ve-fanout-cli": patch
---

Make the OAuth Dynamic Client Registration error message provider-agnostic (RFC 7591) and point at `VE_FANOUT_TOKEN` as the headless alternative, instead of referencing a specific auth provider's dashboard.
