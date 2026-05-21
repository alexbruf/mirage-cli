/**
 * @mirage-cli/firecrawl — wraps the published `firecrawl-cli` npm package as
 * an importable Commander program plus a ready-made mirage CommandFn.
 *
 *   import { firecrawlCommand, buildProgram } from "@mirage-cli/firecrawl";
 *
 * `buildProgram()` is async because firecrawl-cli auto-parses on import; we
 * monkey-patch its internal `Command.prototype.parseAsync` to capture the
 * `Command` instance and no-op the auto-parse. Repeated calls return the same
 * cached instance.
 *
 * `firecrawlCommand` is a `MirageCommandFn` that lazily calls `buildProgram()`
 * on its first invocation, then delegates to `toMirageCommandFn(program)` on
 * every call. Drop it into a `command({ fn: firecrawlCommand })` registration.
 *
 * ## Env vars
 *
 * - `FIRECRAWL_API_KEY` — required by most subcommands. If unset at import
 *   time we default to `"noop"` so the interactive auth prompt doesn't fire
 *   during the capture phase. Set a real key before invoking commands that
 *   actually hit the Firecrawl API.
 * - `FIRECRAWL_NO_TELEMETRY=1` — set unconditionally to suppress import-time
 *   telemetry calls.
 *
 * ## Worker compatibility
 *
 * Hot path is pure ESM imports — no `createRequire`. We rely on npm/bun
 * deduping `commander` between this wrapper and the installed `firecrawl-cli`
 * (both declare `^14`), so monkey-patching `Command.prototype.parseAsync`
 * here affects the prototype firecrawl-cli's CJS code will see at
 * `require("commander")` time. workerd's `nodejs_compat` handles the rest.
 *
 * Runtime behavior depends on whether the specific firecrawl subcommand you
 * invoke touches `fs`/`child_process`. `--help`, `--version`, and the
 * API-call subcommands (`scrape`, `search`, `map`, `crawl`, `parse`) work;
 * `init`, `setup`, `browser`, `interact` will fail at runtime in workers.
 */

import { Command } from "commander";
import { toMirageCommandFn, type IOResultCtor, type MirageCommandFn } from "@mirage-cli/core";
// @struktoai/mirage-core is an optional peer dep — only needed for
// `firecrawlResource()`. Type-only at compile time.
import type {
  RegisteredCommand,
  Resource,
} from "@struktoai/mirage-core";

let cachedProgram: Command | null = null;
let buildPromise: Promise<Command> | null = null;

/**
 * Build (or return the cached) firecrawl-cli Commander program. Async —
 * idempotent across concurrent and repeated calls.
 */
export async function buildProgram(): Promise<Command> {
  if (cachedProgram !== null) return cachedProgram;
  if (buildPromise !== null) return buildPromise;

  buildPromise = (async () => {
    // Monkey-patch Command.prototype.parseAsync. firecrawl-cli's CJS does
    // `require("commander").Command` at module-init; npm/bun dedupes that
    // to the same instance we just imported (both declare ^14), so the
    // patch fires when firecrawl-cli's main() calls parseAsync.
    const origParseAsync = Command.prototype.parseAsync;
    let captured: Command | null = null;
    Command.prototype.parseAsync = async function (
      this: Command,
      ...args: unknown[]
    ) {
      if (captured === null) {
        captured = this;
        return this;
      }
      return (
        origParseAsync as (...a: unknown[]) => Promise<Command>
      ).apply(this, args);
    };

    // Plant argv + env so firecrawl-cli's main() routes through parseAsync
    // (our capture point) rather than the no-arg interactive auth branch.
    const argv0 = process.argv[0] ?? "bun";
    process.argv = [argv0, "firecrawl", "--help"];
    process.env.FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY ?? "noop";
    process.env.FIRECRAWL_NO_TELEMETRY = "1";

    // Dynamic-import triggers firecrawl-cli's module-level main(), which
    // calls our patched parseAsync, which captures `program` and returns.
    await import("firecrawl-cli/dist/index.js");

    if (captured === null) {
      throw new Error(
        "@mirage-cli/firecrawl: failed to capture program instance — " +
          "firecrawl-cli's main() did not invoke Command.prototype.parseAsync. " +
          "This usually means upstream changed its entry point structure.",
      );
    }
    cachedProgram = captured;
    return cachedProgram;
  })();

  return buildPromise;
}

let cachedFn: MirageCommandFn | null = null;

/**
 * Mirage CommandFn for firecrawl-cli. Wires `firecrawl <argv>` from mirage
 * straight into the wrapped CLI's stdout/stderr/exitCode.
 *
 *   import { command, CommandSpec, Operand, OperandKind } from "@struktoai/mirage-core";
 *   import { firecrawlCommand } from "@mirage-cli/firecrawl";
 *
 *   export const fc = command({
 *     name: "firecrawl",
 *     resource: null,
 *     spec: new CommandSpec({
 *       rest: new Operand({ kind: OperandKind.TEXT }),
 *       description: "Firecrawl CLI",
 *     }),
 *     fn: firecrawlCommand,
 *   });
 */
export const firecrawlCommand: MirageCommandFn = async (
  accessor,
  paths,
  texts,
  opts,
) => {
  if (cachedFn === null) {
    const program = await buildProgram();
    cachedFn = toMirageCommandFn(program);
  }
  return cachedFn(accessor, paths, texts, opts);
};

/**
 * Drop-in for a mirage Workspace. Returns a minimal mirage `Resource` whose
 * `commands()` exposes the firecrawl CLI as a general (resource-less) command.
 *
 *   import { firecrawlResource } from "@mirage-cli/firecrawl";
 *   import { Workspace } from "@struktoai/mirage-node";
 *
 *   const ws = new Workspace({ ... });
 *   ws.addMount("/cli/firecrawl", await firecrawlResource());
 *   await ws.execute("firecrawl --version");
 *
 * `@struktoai/mirage-core` is an optional peer dep — dynamic-imported on
 * first call. NOTE: firecrawlCommand itself is async because it needs to
 * lazily capture the upstream Command instance from firecrawl-cli's
 * auto-parse on import.
 */
let cachedResource: Resource | null = null;
export async function firecrawlResource(): Promise<Resource> {
  if (cachedResource !== null) return cachedResource;
  const m = await import("@struktoai/mirage-core");
  const program = await buildProgram();
  const fn = toMirageCommandFn(program, {
    IOResult: m.IOResult as unknown as IOResultCtor,
  });
  // Bypass `m.command()` to preserve commander's `--help` output (see the
  // analogous comment in @mirage-cli/dataforseo).
  const commands: readonly RegisteredCommand[] = [
    new m.RegisteredCommand({
      name: "firecrawl",
      resource: null,
      spec: new m.CommandSpec({
        rest: new m.Operand({ kind: m.OperandKind.TEXT }),
        description: "Firecrawl CLI",
      }),
      fn: fn as unknown as Parameters<typeof m.command>[0]["fn"],
    }),
  ];
  cachedResource = {
    kind: "firecrawl",
    isRemote: true,
    prompt:
      "Firecrawl CLI — scrape, search, map, crawl, parse. Auth via FIRECRAWL_API_KEY env var. Use `firecrawl --help` to discover subcommands.",
    async open() {},
    async close() {},
    commands(): readonly RegisteredCommand[] {
      return commands;
    },
  };
  return cachedResource;
}
