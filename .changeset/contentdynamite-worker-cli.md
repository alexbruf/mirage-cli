---
"@mirage-cli/contentdynamite-cli": major
"@mirage-cli/contentdynamite": major
---

Replace the Content Dynamite CLI with the product's own `ve-dynamite`, generated from the Content Dynamite backend, against the Workers API (`https://content-dynamite.alexthecomputer1.workers.dev`) instead of the retired Python API. Adds Google Business Profile posts, part-by-part article revisions, design systems, landing page reiterate/new-version/criteria/deck/audit, evals, provenance and embed clean-up, account roles, and `login`/`watch` for people at a terminal. A mount mode (`buildProgram({ mount: true, reportCost })`) drops login, watch and `--url` for agent hosts; the wrapper uses it. First npm release; lockstep 1.0.0.
