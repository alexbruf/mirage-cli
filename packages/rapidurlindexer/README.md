# @mirage-cli/rapidurlindexer

Thin Mirage wrapper around [`@mirage-cli/rapidurlindexer-cli`](../rapidurlindexer-cli). It exposes the complete Rapid URL Indexer Commander program as a Mirage command and resource.

```ts
import { rapidurlindexerResource } from "@mirage-cli/rapidurlindexer";

workspace.addMount("/cli/rapidurlindexer", await rapidurlindexerResource());
```

The mounted command is named `rapidurlindexer`. Authentication uses `RAPIDURLINDEXER_API_KEY`.

```text
rapidurlindexer credits balance
rapidurlindexer projects list
rapidurlindexer projects get <project-id>
rapidurlindexer projects create --name <name> --urls-file /sessions/<id>/queue.txt
rapidurlindexer projects report <project-id> [--format json|csv]
```

`projects create` spends credits and is not automatically retried. Gate it at the consuming workspace layer when callers should have read-only access. The URL-file helper understands the Mirage `__MIRAGE_CLI_FILE_IO__` bridge, so mounted `/sessions/...` and `/data/...` files can be submitted without a host filesystem read.

The wrapper exports:

- `buildProgram()`: a cached Commander program.
- `rapidurlindexerCommand`: a ready-made Mirage `CommandFn`.
- `rapidurlindexerResource()`: a minimal mountable Mirage resource.
