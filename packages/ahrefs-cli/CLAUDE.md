# CLAUDE.md — ahrefs-cli

A TS CLI wrapping the Ahrefs API v3. Built so both humans and AI agents can drive it.

## Architecture

```
openapi/ahrefs.json        ← bundled OpenAPI spec (crawled from docs.ahrefs.com)
src/spec.ts                ← runtime spec loader; powers --help text
src/command-builder.ts     ← endpointCommand(): turn a spec entry into a citty command
src/commands/<section>.ts  ← per-section files; list endpoints + per-command overrides
src/client.ts              ← native fetch with auth, disk cache, --explain
src/output.ts              ← table / json / csv renderers
src/cli.ts                 ← entrypoint, wires sections together
tools/build-spec.ts        ← crawler that rebuilds openapi/ahrefs.json
```

## Why the CLI exists

The Ahrefs MCP exposes ~40 endpoints 1:1 with no task-shaped composites. For workflow code (skills that enrich keyword lists, expand PAAs, run audits) you want pipe-friendly commands and deterministic, cached calls — not LLM-orchestrated tool calls. CLI wins on caching, batching, scriptability.

## --help is the AI's manual

Each command's `--help` carries:
- The endpoint summary and description from the spec
- Per-flag type, format, enum values, default, required status
- The Ahrefs param description verbatim

This means an AI invoking the CLI can read `ahrefs <cmd> --help` once and use the command correctly — no docs lookup needed.

## Adding a new endpoint

1. Make sure the endpoint is in `openapi/ahrefs.json`. If not, re-run `bun run tools/build-spec.ts`.
2. Add an entry to the appropriate `src/commands/<section>.ts` using `endpointCommand({...})`.
3. Pick a `defaultSelect` (sensible default columns) and `rowsKey` (the response array key to render).

## Refreshing the spec

Ahrefs doesn't host the OpenAPI spec publicly. The crawler at `tools/build-spec.ts`:
1. Visits each section index page (`/en/api/reference/<section>`)
2. Lists endpoint pages
3. Extracts the per-endpoint OpenAPI fragment from the Next.js RSC payload
4. Resolves RSC back-references (`$N` → text chunks)
5. Merges path + components into one OpenAPI 3.0 document

Run `bun run tools/build-spec.ts` to refresh. Then `bunx openapi-typescript openapi/ahrefs.json -o src/generated/api-types.ts` to regen types.
