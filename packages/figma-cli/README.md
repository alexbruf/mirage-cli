# @mirage-cli/figma-cli

A Figma CLI over the [Figma REST API](https://developers.figma.com/docs/rest-api/). Reads files, node trees, rendered exports, comments, variables, dev resources, and library assets; writes comments, variables, and dev resources.

Built as a plain `fetch` client with no SDK, so it runs unchanged under workerd as well as Node and Bun.

## Install

```sh
bun add @mirage-cli/figma-cli
# or run it without installing
bunx @mirage-cli/figma-cli --help
```

## Credentials

Figma has two token kinds and they are **not** interchangeable at the header level, so the CLI carries the scheme along with the token.

| Env var | Header | Notes |
| --- | --- | --- |
| `FIGMA_OAUTH_ACCESS_TOKEN` | `Authorization: Bearer` | OAuth 2 access token. Wins when both are set, so a host that refreshes per call can inject only this one. |
| `FIGMA_TOKEN` | `X-Figma-Token` | Personal access token. `FIGMA_API_KEY` and `FIGMA_PERSONAL_ACCESS_TOKEN` are accepted as aliases. Figma expires these within 90 days and they cannot be renewed in place. |

Precedence is `--token` > `FIGMA_OAUTH_ACCESS_TOKEN` > `FIGMA_TOKEN` > `FIGMA_API_KEY` > `FIGMA_PERSONAL_ACCESS_TOKEN`. The header is inferred from the token prefix (`figd_` → personal, `figu_`/`figoa` → OAuth) and can be forced with `--auth-scheme bearer|x-figma-token`.

Other env vars: `FIGMA_FILE_KEY`, `FIGMA_TEAM_ID` (defaults for omitted arguments) and `FIGMA_API_BASE_URL` (set to `https://api.figma-gov.com` for Figma for Government).

## Usage

```sh
export FIGMA_TOKEN=figd_XXXXXXXX

figma whoami
figma teams projects 123456789
figma projects files 987654

# Files. Paste the URL or the bare key — both work.
figma files get https://www.figma.com/design/aBc123/My-File
figma files nodes aBc123 --ids 1:23,4-56
figma files meta aBc123
figma files versions aBc123

# Rendered exports. Node ids accept the 1:23 and 1-23 spellings.
figma export aBc123 --ids 1:23 --format svg
figma export aBc123 --ids 1:23,4:56 --format png --scale 2 --save ./frames

# Comments
figma comments list aBc123
figma comments post aBc123 --message "spacing is off here" --node-id 1:23
figma comments delete 1234567890 aBc123

# Design system
figma components file aBc123
figma styles team 123456789
figma variables local aBc123
figma dev-resources list aBc123 --node-ids 1:23

# Raw GET escape hatch
figma api /v1/files/aBc123/versions -q page_size=5
```

## Two things worth knowing

**`files get` defaults to `--depth 2`.** Figma returns the entire node tree when `depth` is omitted, which for a real design file is routinely tens of megabytes — enough to blow a command output buffer and burn a rate-limit slot on a result nobody can read. Depth 2 is pages plus their top-level children. Pass `--depth 0` when you genuinely need the whole tree.

**`export` returns URLs, not bytes.** `GET /v1/images/:key` answers with short-lived S3 links. Print them, or pass `--save <dir>` to download each node to `<dir>/<node-id>.<format>`. `--save` with a file extension writes a single file and requires exactly one `--ids` entry.

## Rate limits

Figma's limits are low and tiered by endpoint, plan, and seat. File, node, and render calls (Tier 1) are 10/min on Starter, 15/min on Professional, and 20/min on Organization and Enterprise. Comments, dev resources, variables, versions, image fills, folders, and projects (Tier 2) are 25/50/100.

A 429 is retried once when `Retry-After` is 35s or less; otherwise it surfaces as an error carrying the plan tier, the limit type, and Figma's upgrade link. Batch `--ids` into one call rather than looping node by node.

## Output

`-f json` (default, the raw API envelope), `jsonl`, `table`, or `csv`. Figma responses nest deeply, so `table`/`csv` stringify non-scalar cells — they are for scanning a list of files or comments, not for reading a design.

## Errors

Errors go to stderr as one JSON object with `error`, `status`, and an actionable `hint`; the exit code is 1.

```json
{"error":"[403] Invalid scope(s)","status":403,"hint":"the token lacks the scope for this endpoint, …"}
```

## Worker compatibility

| Surface | workerd |
| --- | --- |
| Every read and write command | ✅ pure `fetch` |
| `export --save` into a Mirage VFS path | ✅ via `globalThis.__MIRAGE_CLI_FILE_IO__` |
| `export --save` to a local path | ⚠️ falls back to `node:fs` (dynamically imported) |
| `--body-file -` (stdin) | ✅ via the host's `ByteSource` stdin |
