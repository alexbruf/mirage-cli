import { Command } from "commander";
import { ApiError, fetchRenderedImage, FigmaClient, type Query } from "./client.ts";
import {
  fingerprint,
  getDefaultBaseUrl,
  normalizeNodeIds,
  resolveFileKey,
  resolveTeamId,
  resolveToken,
} from "./config.ts";
import { readJsonFile, writeBytes } from "./fileio.ts";
import { mapToRows, parseFormat, renderList, renderObject, type Format } from "./output.ts";

/**
 * Build the Figma Commander program. Pure function — no side effects, no
 * caching — because Mirage hosts rebuild the program on every invocation
 * (Commander stores parsed option state on the instance, so a reused program
 * leaks flags across calls).
 *
 * Command names are grouped so a host can gate writes with a prefix match:
 * every mutating verb lives under `comments post|delete|react|unreact`,
 * `variables post`, or `dev-resources create|update|delete`. Everything else
 * is a read. Keep that property when adding commands.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name("figma")
    .description(
      "Figma CLI — read files, node trees, rendered exports, comments, variables, dev " +
        "resources, and library assets over the Figma REST API.",
    )
    .version("0.1.0")
    .option("--token <token>", "Access token (or FIGMA_TOKEN / FIGMA_OAUTH_ACCESS_TOKEN env)")
    .option("--auth-scheme <scheme>", "bearer | x-figma-token (default: inferred from the token)")
    .option("--file-key <key>", "Default file key or URL (or FIGMA_FILE_KEY env)")
    .option("--team-id <id>", "Default team id (or FIGMA_TEAM_ID env)")
    .option("--base-url <url>", "API base URL (or FIGMA_API_BASE_URL env)")
    .option("-f, --format <fmt>", "Output format: json | jsonl | table | csv", "json")
    .addHelpText(
      "after",
      `
Credentials (resolved per call):
  token:  --token > FIGMA_OAUTH_ACCESS_TOKEN > FIGMA_TOKEN > FIGMA_API_KEY
  header: an OAuth token goes in Authorization: Bearer, a personal access token
          in X-Figma-Token. The header is inferred from the token prefix and can
          be forced with --auth-scheme.
  Personal access tokens expire within 90 days: https://www.figma.com/developers/api

File keys: pass a key or paste the URL — both work.
  https://www.figma.com/design/<key>/<name>?node-id=1-23
Node ids: "1:23" and the URL spelling "1-23" are both accepted.

Rate limits are low and tiered. File, node, and render calls are 10/min on
Starter and 20/min on Organization, so batch --ids into one call rather than
looping node by node.

Examples:
  figma whoami
  figma teams projects 123456789
  figma projects files 987654
  figma files get <key>                        # depth 2 by default, see below
  figma files get <key> --depth 0              # WHOLE tree, often tens of MB
  figma files nodes <key> --ids 1:23,4:56
  figma export <key> --ids 1:23 --format svg
  figma export <key> --ids 1:23,4:56 --format png --scale 2 --save /data/frames
  figma comments list <key>
  figma comments post <key> --message "spacing is off here" --node-id 1:23
  figma variables local <key>
  figma dev-resources list <key> --node-ids 1:23
  figma api /v1/files/<key>/versions            # raw GET escape hatch`,
    );

  function globalOpts(): {
    token?: string;
    authScheme?: string;
    fileKey?: string;
    teamId?: string;
    baseUrl?: string;
    format: Format;
  } {
    const opts = program.opts<{
      token?: string;
      authScheme?: string;
      fileKey?: string;
      teamId?: string;
      baseUrl?: string;
      format?: string;
    }>();
    return { ...opts, format: parseFormat(opts.format) };
  }

  function fail(err: unknown): never {
    if (err instanceof ApiError) {
      process.stderr.write(
        JSON.stringify({
          error: err.message,
          status: err.status,
          ...(err.hint ? { hint: err.hint } : {}),
        }) + "\n",
      );
    } else {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(JSON.stringify({ error: message }) + "\n");
    }
    process.exit(1);
  }

  function getClient(): FigmaClient {
    const { token, authScheme, baseUrl } = globalOpts();
    try {
      const resolved = resolveToken({ token, authScheme });
      return new FigmaClient({
        token: resolved.token,
        scheme: resolved.scheme,
        ...(baseUrl ? { baseUrl } : {}),
      });
    } catch (err) {
      return fail(err);
    }
  }

  function fileKey(explicit?: string): string {
    try {
      return resolveFileKey({ fileKey: globalOpts().fileKey }, explicit);
    } catch (err) {
      return fail(err);
    }
  }

  function teamId(explicit?: string): string {
    try {
      return resolveTeamId({ teamId: globalOpts().teamId }, explicit);
    } catch (err) {
      return fail(err);
    }
  }

  function outObject(obj: unknown): void {
    console.log(renderObject(obj, globalOpts().format));
  }

  function outList(envelope: unknown, records: unknown[]): void {
    console.log(renderList(envelope, records, globalOpts().format));
  }

  /** Run a read and render its result, converting any throw into a structured exit 1. */
  async function read(fn: (client: FigmaClient) => Promise<void>): Promise<void> {
    const client = getClient();
    try {
      await fn(client);
    } catch (err) {
      fail(err);
    }
  }

  function requireIds(raw: string | undefined, flag = "--ids"): string[] {
    if (!raw) fail(new Error(`Missing ${flag} <nodeId,...>`));
    const ids = normalizeNodeIds(raw);
    if (ids.length === 0) fail(new Error(`${flag} did not contain a node id`));
    return ids;
  }

  // ── identity ──

  program
    .command("whoami")
    .description("The authenticated user (GET /v1/me)")
    .action(async () =>
      read(async (client) => {
        const me = await client.get<Record<string, unknown>>("/v1/me");
        const { token } = resolveToken({
          token: globalOpts().token,
          authScheme: globalOpts().authScheme,
        });
        outObject({ ...me, token: fingerprint(token) });
      }),
    );

  // ── teams, projects, folders ──

  const teams = program.command("teams").description("Team-level listings");

  teams
    .command("projects [team_id]")
    .description("Projects in a team (GET /v1/teams/:team_id/projects)")
    .action(async (id?: string) =>
      read(async (client) => {
        const env = await client.get<{ projects?: unknown[] }>(`/v1/teams/${teamId(id)}/projects`);
        outList(env, env.projects ?? []);
      }),
    );

  const projects = program.command("projects").description("Project-level listings");

  projects
    .command("files <project_id>")
    .description("Files in a project (GET /v1/projects/:project_id/files)")
    .option("--branch-data", "Include branch metadata for each file")
    .action(async (id: string, opts: { branchData?: boolean }) =>
      read(async (client) => {
        const env = await client.get<{ files?: unknown[] }>(`/v1/projects/${id}/files`, {
          ...(opts.branchData ? { branch_data: "true" } : {}),
        });
        outList(env, env.files ?? []);
      }),
    );

  projects
    .command("meta <project_id>")
    .description("Project metadata (GET /v1/projects/:project_id/meta)")
    .action(async (id: string) =>
      read(async (client) => outObject(await client.get(`/v1/projects/${id}/meta`))),
    );

  const folders = program.command("folders").description("Folder listings (v2 API)");

  folders
    .command("list [team_id]")
    .description("Top-level folders in a team (GET /v2/teams/:team_id/folders)")
    .action(async (id?: string) =>
      read(async (client) => {
        const env = await client.get<{ folders?: unknown[] }>(`/v2/teams/${teamId(id)}/folders`);
        outList(env, env.folders ?? []);
      }),
    );

  folders
    .command("children <folder_id>")
    .description("Folders inside a folder (GET /v2/folders/:folder_id/folders)")
    .action(async (id: string) =>
      read(async (client) => {
        const env = await client.get<{ folders?: unknown[] }>(`/v2/folders/${id}/folders`);
        outList(env, env.folders ?? []);
      }),
    );

  folders
    .command("files <folder_id>")
    .description("Files inside a folder (GET /v2/folders/:folder_id/files)")
    .action(async (id: string) =>
      read(async (client) => {
        const env = await client.get<{ files?: unknown[] }>(`/v2/folders/${id}/files`);
        outList(env, env.files ?? []);
      }),
    );

  folders
    .command("meta <folder_id>")
    .description("Folder metadata (GET /v2/folders/:folder_id/meta)")
    .action(async (id: string) =>
      read(async (client) => outObject(await client.get(`/v2/folders/${id}/meta`))),
    );

  // ── files ──

  const files = program.command("files").description("File contents and metadata");

  /**
   * `depth` is the single most important flag on this CLI. Figma returns the
   * ENTIRE node tree when it is omitted, which for a real design file is
   * routinely tens of megabytes — enough to blow a command output buffer and
   * burn a Tier-1 rate-limit slot for a result nobody can read. Default to 2
   * (pages plus their top-level children) and make the full tree an explicit
   * `--depth 0`.
   */
  function depthQuery(depth: string | undefined): Query {
    if (depth === undefined) return { depth: 2 };
    const n = Number(depth);
    if (!Number.isFinite(n) || n < 0) {
      fail(new Error(`--depth must be a non-negative integer, got "${depth}"`));
    }
    return n === 0 ? {} : { depth: n };
  }

  files
    .command("get [file]")
    .description("A file's document tree (GET /v1/files/:key). Defaults to --depth 2")
    .option("--depth <n>", "Tree depth; 0 fetches the whole file (can be tens of MB)")
    .option("--ids <ids>", "Restrict to these node ids and their subtrees")
    .option("--version <id>", "A specific version id (see `figma files versions`)")
    .option("--geometry", "Include vector path data")
    .option("--branch-data", "Include branch metadata")
    .option("--plugin-data <ids>", "Include plugin data for these plugin ids")
    .action(
      async (
        file: string | undefined,
        opts: {
          depth?: string;
          ids?: string;
          version?: string;
          geometry?: boolean;
          branchData?: boolean;
          pluginData?: string;
        },
      ) =>
        read(async (client) => {
          outObject(
            await client.get(`/v1/files/${fileKey(file)}`, {
              ...depthQuery(opts.depth),
              ...(opts.ids ? { ids: normalizeNodeIds(opts.ids) } : {}),
              ...(opts.version ? { version: opts.version } : {}),
              ...(opts.geometry ? { geometry: "paths" } : {}),
              ...(opts.branchData ? { branch_data: "true" } : {}),
              ...(opts.pluginData ? { plugin_data: opts.pluginData } : {}),
            }),
          );
        }),
    );

  files
    .command("nodes [file]")
    .description("Specific nodes from a file (GET /v1/files/:key/nodes)")
    .requiredOption("--ids <ids>", "Node ids, comma separated (1:23 or 1-23)")
    .option("--depth <n>", "Tree depth below each node; 0 fetches the whole subtree")
    .option("--version <id>", "A specific version id")
    .option("--geometry", "Include vector path data")
    .action(
      async (
        file: string | undefined,
        opts: { ids: string; depth?: string; version?: string; geometry?: boolean },
      ) =>
        read(async (client) => {
          const env = await client.get<{ nodes?: Record<string, unknown> }>(
            `/v1/files/${fileKey(file)}/nodes`,
            {
              ids: requireIds(opts.ids),
              ...depthQuery(opts.depth),
              ...(opts.version ? { version: opts.version } : {}),
              ...(opts.geometry ? { geometry: "paths" } : {}),
            },
          );
          outList(env, mapToRows(env.nodes));
        }),
    );

  files
    .command("meta [file]")
    .description("File metadata: name, owner, editor type (GET /v1/files/:key/meta)")
    .action(async (file?: string) =>
      read(async (client) => outObject(await client.get(`/v1/files/${fileKey(file)}/meta`))),
    );

  files
    .command("versions [file]")
    .description("Version history (GET /v1/files/:key/versions)")
    .option("--page-size <n>", "Versions per page")
    .option("--before <id>", "Version id to page backwards from")
    .option("--after <id>", "Version id to page forwards from")
    .action(
      async (
        file: string | undefined,
        opts: { pageSize?: string; before?: string; after?: string },
      ) =>
        read(async (client) => {
          const env = await client.get<{ versions?: unknown[] }>(
            `/v1/files/${fileKey(file)}/versions`,
            {
              ...(opts.pageSize ? { page_size: opts.pageSize } : {}),
              ...(opts.before ? { before: opts.before } : {}),
              ...(opts.after ? { after: opts.after } : {}),
            },
          );
          outList(env, env.versions ?? []);
        }),
    );

  // ── rendered images ──

  const EXPORT_FORMATS = ["png", "jpg", "svg", "pdf"] as const;

  /**
   * `--save` names a directory when it has no file extension, in which case
   * each node lands at `<dir>/<node-id>.<format>` with the colon replaced (it
   * is not a legal filename character on every host). With an extension it is
   * a single file path and only one `--ids` entry is allowed.
   */
  function savePathFor(save: string, nodeId: string, format: string, single: boolean): string {
    const base = save.replace(/\/$/, "");
    const looksLikeFile = /\.[A-Za-z0-9]+$/.test(base.split("/").pop() ?? "");
    if (looksLikeFile) {
      if (!single) {
        fail(new Error("--save points at a file but --ids has several nodes; pass a directory"));
      }
      return base;
    }
    return `${base}/${nodeId.replace(/:/g, "-")}.${format}`;
  }

  program
    .command("export [file]")
    .description("Render nodes to png/jpg/svg/pdf (GET /v1/images/:key)")
    .requiredOption("--ids <ids>", "Node ids to render, comma separated")
    .option("--format <fmt>", `Image format: ${EXPORT_FORMATS.join(" | ")}`, "png")
    .option("--scale <n>", "Scale 0.01–4, raster formats only")
    .option("--version <id>", "Render a specific version")
    .option("--use-absolute-bounds", "Render the full node bounds, ignoring cropping")
    .option("--contents-only <bool>", "Exclude overlapping content outside the node")
    .option("--svg-outline-text <bool>", "SVG: outline text instead of using <text>")
    .option("--svg-include-id", "SVG: emit id attributes")
    .option("--svg-include-node-id", "SVG: emit data-node-id attributes")
    .option("--svg-simplify-stroke <bool>", "SVG: simplify strokes into a single path")
    .option("--save <path>", "Download the renders to a directory (or a single file path)")
    .action(
      async (
        file: string | undefined,
        opts: {
          ids: string;
          format?: string;
          scale?: string;
          version?: string;
          useAbsoluteBounds?: boolean;
          contentsOnly?: string;
          svgOutlineText?: string;
          svgIncludeId?: boolean;
          svgIncludeNodeId?: boolean;
          svgSimplifyStroke?: string;
          save?: string;
        },
      ) =>
        read(async (client) => {
          const format = (opts.format ?? "png").toLowerCase();
          if (!(EXPORT_FORMATS as readonly string[]).includes(format)) {
            fail(new Error(`--format must be one of ${EXPORT_FORMATS.join(", ")}`));
          }
          const ids = requireIds(opts.ids);
          const env = await client.get<{ err?: string | null; images?: Record<string, string> }>(
            `/v1/images/${fileKey(file)}`,
            {
              ids,
              format,
              ...(opts.scale ? { scale: opts.scale } : {}),
              ...(opts.version ? { version: opts.version } : {}),
              ...(opts.useAbsoluteBounds ? { use_absolute_bounds: "true" } : {}),
              ...(opts.contentsOnly ? { contents_only: opts.contentsOnly } : {}),
              ...(opts.svgOutlineText ? { svg_outline_text: opts.svgOutlineText } : {}),
              ...(opts.svgIncludeId ? { svg_include_id: "true" } : {}),
              ...(opts.svgIncludeNodeId ? { svg_include_node_id: "true" } : {}),
              ...(opts.svgSimplifyStroke ? { svg_simplify_stroke: opts.svgSimplifyStroke } : {}),
            },
          );
          // Figma answers 200 with a populated `err` when a node fails to
          // render, so a bare status check is not enough to call this a success.
          if (env.err) throw new ApiError(200, String(env.err), "check the node ids and --format");
          const images = env.images ?? {};

          if (!opts.save) {
            outList(env, mapToRows(images));
            return;
          }

          const single = Object.keys(images).length === 1;
          const saved: { id: string; path: string; bytes: number }[] = [];
          for (const [nodeId, url] of Object.entries(images)) {
            if (!url) continue;
            const bytes = await fetchRenderedImage(url);
            const path = savePathFor(opts.save, nodeId, format, single);
            await writeBytes(path, bytes);
            saved.push({ id: nodeId, path, bytes: bytes.byteLength });
          }
          outList({ saved }, saved);
        }),
    );

  program
    .command("image-fills [file]")
    .description("Download links for every image fill in a file (GET /v1/files/:key/images)")
    .action(async (file?: string) =>
      read(async (client) => {
        const env = await client.get<{ meta?: { images?: Record<string, string> } }>(
          `/v1/files/${fileKey(file)}/images`,
        );
        outList(env, mapToRows(env.meta?.images));
      }),
    );

  // ── library assets: components, component sets, styles ──

  /**
   * The three library asset kinds share an identical endpoint triple
   * (`/v1/files/:key/X`, `/v1/teams/:id/X`, `/v1/X/:key`), so the subcommands
   * are generated rather than written out three times.
   */
  function addLibraryCommands(name: string, segment: string, collection: string): void {
    const group = program.command(name).description(`Published ${name.replace(/-/g, " ")}`);

    group
      .command("file [file]")
      .description(`${collection} in a file (GET /v1/files/:key/${segment})`)
      .action(async (file?: string) =>
        read(async (client) => {
          const env = await client.get<{ meta?: Record<string, unknown> }>(
            `/v1/files/${fileKey(file)}/${segment}`,
          );
          outList(env, (env.meta?.[collection] as unknown[] | undefined) ?? []);
        }),
      );

    group
      .command("team [team_id]")
      .description(`${collection} published by a team (GET /v1/teams/:team_id/${segment})`)
      .option("--page-size <n>", "Results per page")
      .option("--after <cursor>", "Page forwards from this cursor")
      .option("--before <cursor>", "Page backwards from this cursor")
      .action(
        async (
          id: string | undefined,
          opts: { pageSize?: string; after?: string; before?: string },
        ) =>
          read(async (client) => {
            const env = await client.get<{ meta?: Record<string, unknown> }>(
              `/v1/teams/${teamId(id)}/${segment}`,
              {
                ...(opts.pageSize ? { page_size: opts.pageSize } : {}),
                ...(opts.after ? { after: opts.after } : {}),
                ...(opts.before ? { before: opts.before } : {}),
              },
            );
            outList(env, (env.meta?.[collection] as unknown[] | undefined) ?? []);
          }),
      );

    group
      .command("get <key>")
      .description(`One published item by key (GET /v1/${segment}/:key)`)
      .action(async (key: string) =>
        read(async (client) => outObject(await client.get(`/v1/${segment}/${key}`))),
      );
  }

  addLibraryCommands("components", "components", "components");
  addLibraryCommands("component-sets", "component_sets", "component_sets");
  addLibraryCommands("styles", "styles", "styles");

  // ── comments ──

  const comments = program.command("comments").description("File comments and reactions");

  comments
    .command("list [file]")
    .description("Comments on a file (GET /v1/files/:key/comments)")
    .option("--as-md", "Return comment bodies as markdown")
    .action(async (file: string | undefined, opts: { asMd?: boolean }) =>
      read(async (client) => {
        const env = await client.get<{ comments?: unknown[] }>(
          `/v1/files/${fileKey(file)}/comments`,
          { ...(opts.asMd ? { as_md: "true" } : {}) },
        );
        outList(env, env.comments ?? []);
      }),
    );

  comments
    .command("post [file]")
    .description("Leave a comment (POST /v1/files/:key/comments) — needs file_comments:write")
    .requiredOption("-m, --message <text>", "Comment body")
    .option("--node-id <id>", "Pin the comment to a node")
    .option("--x <n>", "Node-relative x offset for the pin", "0")
    .option("--y <n>", "Node-relative y offset for the pin", "0")
    .option("--reply-to <comment_id>", "Reply inside an existing thread")
    .action(
      async (
        file: string | undefined,
        opts: { message: string; nodeId?: string; x: string; y: string; replyTo?: string },
      ) =>
        read(async (client) => {
          const body: Record<string, unknown> = { message: opts.message };
          if (opts.replyTo) body.comment_id = opts.replyTo;
          if (opts.nodeId) {
            body.client_meta = {
              node_id: normalizeNodeIds(opts.nodeId)[0],
              node_offset: { x: Number(opts.x), y: Number(opts.y) },
            };
          }
          outObject(await client.post(`/v1/files/${fileKey(file)}/comments`, body));
        }),
    );

  comments
    .command("delete <comment_id> [file]")
    .description("Delete a comment (DELETE /v1/files/:key/comments/:id)")
    .action(async (commentId: string, file?: string) =>
      read(async (client) =>
        outObject(await client.del(`/v1/files/${fileKey(file)}/comments/${commentId}`)),
      ),
    );

  comments
    .command("reactions <comment_id> [file]")
    .description("Reactions on a comment (GET /v1/files/:key/comments/:id/reactions)")
    .action(async (commentId: string, file?: string) =>
      read(async (client) => {
        const env = await client.get<{ reactions?: unknown[] }>(
          `/v1/files/${fileKey(file)}/comments/${commentId}/reactions`,
        );
        outList(env, env.reactions ?? []);
      }),
    );

  comments
    .command("react <comment_id> [file]")
    .description("Add a reaction (POST /v1/files/:key/comments/:id/reactions)")
    .requiredOption("--emoji <emoji>", "Emoji shortcode, e.g. :eyes:")
    .action(async (commentId: string, file: string | undefined, opts: { emoji: string }) =>
      read(async (client) =>
        outObject(
          await client.post(`/v1/files/${fileKey(file)}/comments/${commentId}/reactions`, {
            emoji: opts.emoji,
          }),
        ),
      ),
    );

  comments
    .command("unreact <comment_id> [file]")
    .description("Remove a reaction (DELETE /v1/files/:key/comments/:id/reactions)")
    .requiredOption("--emoji <emoji>", "Emoji shortcode to remove")
    .action(async (commentId: string, file: string | undefined, opts: { emoji: string }) =>
      read(async (client) =>
        outObject(
          await client.del(`/v1/files/${fileKey(file)}/comments/${commentId}/reactions`, {
            emoji: opts.emoji,
          }),
        ),
      ),
    );

  // ── variables ──

  const variables = program
    .command("variables")
    .description("Design system variables — the whole group requires an Enterprise plan");

  variables
    .command("local [file]")
    .description("Local variables (GET /v1/files/:key/variables/local)")
    .action(async (file?: string) =>
      read(async (client) => {
        const env = await client.get<{ meta?: Record<string, unknown> }>(
          `/v1/files/${fileKey(file)}/variables/local`,
        );
        outList(env, mapToRows(env.meta?.variables));
      }),
    );

  variables
    .command("published [file]")
    .description("Published variables (GET /v1/files/:key/variables/published)")
    .action(async (file?: string) =>
      read(async (client) => {
        const env = await client.get<{ meta?: Record<string, unknown> }>(
          `/v1/files/${fileKey(file)}/variables/published`,
        );
        outList(env, mapToRows(env.meta?.variables));
      }),
    );

  variables
    .command("post [file]")
    .description(
      "Create, update, or delete variables (POST /v1/files/:key/variables). Destructive — " +
        "it edits a live design system",
    )
    .requiredOption(
      "--body-file <path>",
      'JSON body with variableCollections / variableModes / variables / variableModeValues ("-" reads stdin)',
    )
    .action(async (file: string | undefined, opts: { bodyFile: string }) =>
      read(async (client) => {
        const body = await readJsonFile<Record<string, unknown>>(opts.bodyFile);
        outObject(await client.post(`/v1/files/${fileKey(file)}/variables`, body));
      }),
    );

  // ── dev resources ──

  const devResources = program
    .command("dev-resources")
    .description("Developer links attached to nodes, shown in Dev Mode");

  devResources
    .command("list [file]")
    .description("Dev resources in a file (GET /v1/files/:key/dev_resources)")
    .option("--node-ids <ids>", "Restrict to these node ids")
    .action(async (file: string | undefined, opts: { nodeIds?: string }) =>
      read(async (client) => {
        const env = await client.get<{ dev_resources?: unknown[] }>(
          `/v1/files/${fileKey(file)}/dev_resources`,
          { ...(opts.nodeIds ? { node_ids: normalizeNodeIds(opts.nodeIds) } : {}) },
        );
        outList(env, env.dev_resources ?? []);
      }),
    );

  devResources
    .command("create")
    .description("Attach dev resources to nodes (POST /v1/dev_resources)")
    .option(
      "--body-file <path>",
      'JSON body: { "dev_resources": [{ name, url, file_key, node_id }] } ("-" reads stdin)',
    )
    .option("--name <name>", "Single resource: link title")
    .option("--url <url>", "Single resource: link target")
    .option("--node-id <id>", "Single resource: node to attach to")
    .action(
      async (opts: { bodyFile?: string; name?: string; url?: string; nodeId?: string }) =>
        read(async (client) => {
          const body = opts.bodyFile
            ? await readJsonFile<Record<string, unknown>>(opts.bodyFile)
            : singleDevResource(opts);
          outObject(await client.post("/v1/dev_resources", body));
        }),
    );

  devResources
    .command("update")
    .description("Update existing dev resources (PUT /v1/dev_resources)")
    .requiredOption(
      "--body-file <path>",
      'JSON body: { "dev_resources": [{ id, name?, url? }] } ("-" reads stdin)',
    )
    .action(async (opts: { bodyFile: string }) =>
      read(async (client) => {
        const body = await readJsonFile<Record<string, unknown>>(opts.bodyFile);
        outObject(await client.put("/v1/dev_resources", body));
      }),
    );

  devResources
    .command("delete <dev_resource_id> [file]")
    .description("Delete one dev resource (DELETE /v1/files/:key/dev_resources/:id)")
    .action(async (devResourceId: string, file?: string) =>
      read(async (client) =>
        outObject(await client.del(`/v1/files/${fileKey(file)}/dev_resources/${devResourceId}`)),
      ),
    );

  /** Assemble the POST body for the convenience flags on `dev-resources create`. */
  function singleDevResource(opts: {
    name?: string;
    url?: string;
    nodeId?: string;
  }): Record<string, unknown> {
    if (!opts.name || !opts.url || !opts.nodeId) {
      fail(
        new Error(
          "Pass --body-file, or all of --name, --url and --node-id to attach a single resource",
        ),
      );
    }
    return {
      dev_resources: [
        {
          name: opts.name,
          url: opts.url,
          file_key: fileKey(),
          node_id: normalizeNodeIds(opts.nodeId)[0],
        },
      ],
    };
  }

  // ── raw GET escape hatch ──

  program
    .command("api <path>")
    .description("Raw GET against any Figma API path, e.g. `figma api /v1/files/<key>/versions`")
    .option(
      "-q, --query <k=v...>",
      "Query params (repeatable)",
      (v: string, acc: string[]) => {
        acc.push(v);
        return acc;
      },
      [] as string[],
    )
    .action(async (path: string, opts: { query: string[] }) =>
      read(async (client) => {
        const query: Query = {};
        for (const pair of opts.query) {
          const sep = pair.indexOf("=");
          if (sep <= 0) fail(new Error(`Bad query param "${pair}" — expected k=v`));
          query[pair.slice(0, sep)] = pair.slice(sep + 1);
        }
        outObject(await client.get(path, query));
      }),
    );

  return program;
}

export { getDefaultBaseUrl };
