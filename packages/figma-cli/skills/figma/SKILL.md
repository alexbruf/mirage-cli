---
name: figma
description: |
  Read and annotate Figma designs via the `figma` CLI: browse teams, projects and folders, pull a file's node tree, render frames to PNG/SVG/JPG/PDF, read and post comments, and read or write design variables, dev resources, components and styles. Use whenever the user asks about a Figma file or link — "what's in this Figma", "export these frames", "what are the design tokens", "leave a comment on this frame", "what components does this library publish", "what changed in this file" — or asks you to implement a design from a Figma URL. Accepts a pasted figma.com URL anywhere a file key is expected. Returns JSON (default, jq-friendly), JSONL, tables, or CSV. Full param docs via `figma <command> --help`.
allowed-tools:
  - Bash(figma *)
  - Bash(bunx figma *)
---

# figma

Client for the Figma REST API. Most commands are reads; the mutating ones are grouped under `comments post|delete|react|unreact`, `variables post`, and `dev-resources create|update|delete`.

## Setup

Either credential works, and they use different headers — the CLI picks the right one.

```sh
export FIGMA_TOKEN=figd_XXXXXXXX          # personal access token → X-Figma-Token
# or
export FIGMA_OAUTH_ACCESS_TOKEN=figu_...  # OAuth access token → Authorization: Bearer

figma whoami
```

Personal access tokens expire within 90 days. Optional: `FIGMA_FILE_KEY` and `FIGMA_TEAM_ID` as defaults so you can omit the argument.

## Finding your way to a file

```sh
figma teams projects <team_id>       # projects in a team
figma projects files <project_id>    # files in a project
figma folders list <team_id>         # or browse folders
figma folders files <folder_id>
```

You rarely need this when the user pastes a link — every command that takes a file accepts the URL directly.

## Reading a design

```sh
figma files meta <key>                          # name, owner, editor type — cheap orientation
figma files get <key>                           # document tree, depth 2
figma files get <key> --ids 1:23                # one branch of the tree
figma files nodes <key> --ids 1:23,4:56         # several specific nodes
figma files versions <key>                      # version history
```

**Start with `files meta`, then `files get`, then narrow with `files nodes --ids`.** `files get` defaults to `--depth 2` (pages plus their top-level children) on purpose: Figma returns the entire tree when depth is omitted, and a real design file is routinely tens of megabytes. Only pass `--depth 0` when you actually need the full tree, and expect it to be slow and large.

Node ids appear as `1-23` in URLs and `1:23` in the API. Both spellings work everywhere here.

## Rendering frames

```sh
figma export <key> --ids 1:23 --format svg
figma export <key> --ids 1:23,4:56 --format png --scale 2 --save /data/frames
```

Without `--save` you get short-lived render URLs. With `--save <dir>` each node is downloaded to `<dir>/<node-id>.<format>`; pass a path with an extension to write a single file (one `--ids` entry only).

## Design system

```sh
figma components file <key>          # components published from this file
figma components team <team_id>      # everything the team publishes
figma styles file <key>
figma variables local <key>          # design tokens — Enterprise plans only
figma variables published <key>
figma dev-resources list <key> --node-ids 1:23
```

The `variables` group needs an Enterprise plan; on any other plan it returns 403.

## Commenting

```sh
figma comments list <key>
figma comments post <key> --message "this padding is 12, spec says 16" --node-id 1:23
figma comments post <key> --message "agreed" --reply-to <comment_id>
figma comments react <comment_id> <key> --emoji :eyes:
figma comments delete <comment_id> <key>
```

Pin a comment to a node with `--node-id` so it lands in context rather than at the canvas origin.

## Writing dev resources

```sh
figma dev-resources create --name "PR 412" --url https://github.com/org/repo/pull/412 --node-id 1:23
figma dev-resources update --body-file /data/updates.json
figma dev-resources delete <dev_resource_id> <key>
```

Bulk creates and every update go through `--body-file` (or `-` for stdin), taking `{"dev_resources": [...]}`.

## Rate limits

Low and tiered. File, node, and render calls are 10/min on Starter and 20/min on Organization; comments, variables, dev resources, and listings are 25–100/min. **Batch `--ids` into one call rather than looping node by node** — this is the single easiest way to get rate limited. A 429 retries once automatically and then reports the plan tier and reset window.

## Output

`-f json` (default), `jsonl`, `table`, `csv`. Prefer `json` and pipe to `jq`; `table` and `csv` stringify nested values, so they suit lists of files or comments rather than node trees.

## Escape hatch

```sh
figma api /v1/files/<key>/versions -q page_size=5
```

Raw GET against any API path, for endpoints without a dedicated subcommand.
