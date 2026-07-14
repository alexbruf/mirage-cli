# @mirage-cli/openrouter-cli

Fetch-only OpenRouter CLI for model discovery, API-key quota inspection,
generation cost metadata, and chat completions. It exposes a pure
`buildProgram()` for in-process hosts and a standalone `openrouter` binary.

## Install and authenticate

```sh
bun add @mirage-cli/openrouter-cli
export OPENROUTER_API_KEY='sk-or-v1-...'
```

Optional configuration:

- `OPENROUTER_API_BASE_URL` defaults to `https://openrouter.ai/api/v1`.
- `OPENROUTER_HTTP_REFERER` sets the optional `HTTP-Referer` attribution header.
- `OPENROUTER_APP_TITLE` sets `X-OpenRouter-Title`.
- `OPENROUTER_APP_CATEGORIES` sets `X-OpenRouter-Categories`.

All values also have equivalent global CLI flags. Secrets are never persisted
or printed.

## Commands

```sh
openrouter models list --supports tools --sort pricing-low-to-high -f table
openrouter models get openai/gpt-4o
openrouter models endpoints anthropic/claude-sonnet-4.6
openrouter providers list
openrouter key
openrouter generation gen-abc123
openrouter chat --model openai/gpt-4o --prompt 'Say hello' -f text
```

`chat` is billable. It requires an explicit `model` or `models` field and adds
a conservative `max_completion_tokens: 2048` cap when the request omits one.
Override it with `--max-completion-tokens` or in a request file.

For tools, structured output, multimodal messages, fallback models, plugins,
or other OpenRouter fields, pass a complete JSON body:

```sh
openrouter chat --request ./request.json
cat request.json | openrouter chat --request -
```

The request path is fixed to `/chat/completions`; this package intentionally
does not expose arbitrary HTTP methods or API-key management endpoints.

## Streaming

`openrouter chat --stream` parses OpenRouter SSE correctly:

- comment heartbeats are ignored;
- `[DONE]` terminates the stream;
- the final usage-only chunk is preserved;
- `X-Generation-Id` is captured;
- an in-band error chunk exits nonzero even though its HTTP status is 200.

The standalone binary writes `-f text` deltas immediately. Mirage command
runtimes may materialize stdout before returning it, so streaming there is
correct but may not appear token by token.

## Output

JSON is the default. `jsonl`, `table`, `csv`, and `text` are available through
`-f, --format`. Chat JSON preserves the upstream OpenAI-compatible response,
including `usage.cost`, finish reasons, tool calls, and provider metadata.

## Retry behavior

Read-only GET requests retry once only when a `429` or `503` includes a numeric
`Retry-After` of at most 15 seconds. Billable chat POST requests are not
automatically retried because a network failure may be ambiguous and the API
does not document a chat idempotency key.

## Library use

```ts
import { buildProgram, OpenRouterClient } from "@mirage-cli/openrouter-cli";

const program = buildProgram();
const client = new OpenRouterClient({ apiKey: process.env.OPENROUTER_API_KEY! });
```

Requires Bun 1.1+ or Node 18+ with global `fetch`.
