# Wrapping `firecrawl-cli` — what the scanner says vs. what actually happens

A worked example showing where `mirage-commander`'s `checkCompatSource` is right, where it over-reports, and what it takes to wrap the real published `firecrawl-cli` npm package in-process.

## TL;DR

**`checkCompatSource` over-reports for firecrawl-cli.** It flags 29 "errors" — every `require("fs")` and `require("child_process")` in the source tree. But under `nodejs_compat`, those `require()`s **succeed** in workerd; they only fail when the host actually calls into the unsupported runtime methods. Importing firecrawl-cli is fine. Running `--help`, `--version`, `scrape --help`, etc. is fine. The fs/child_process surface only matters when you invoke commands that exercise it (`init`, `setup`, `browser`, the `--output <file>` save paths).

**What does block:** firecrawl-cli's structural design — auto-parse on import, no exported `program`. Both are sidesteppable in a few lines.

A working wrapper of the real published package is in [`wrap-firecrawl.ts`](./wrap-firecrawl.ts) — `bun examples/wrap-firecrawl.ts`. Output:

```
=== captured program ===
name: firecrawl
version: 1.18.0
subcommands (21):
  scrape, crawl, map, parse, monitor, search, search-feedback, agent,
  interact, browser, create, experimental, config, view-config, login,
  logout, init, setup, env, credit-usage, version

=== runCommander(firecrawl, ['--version']) ===     exitCode: 0, stdout: "1.18.0"
=== runCommander(firecrawl, ['--help']) ===        exitCode: 0
=== runCommander(firecrawl, ['scrape', '--help']) === exitCode: 0
=== runCommander(firecrawl, ['nope']) ===          exitCode: 1, stderr: "unknown command 'nope'"
```

## What `checkCompatSource` reported

Static scan: **29 errors, 90 warnings across 28 files**. Errors break down:

- `node:fs` (18 sites)
- `node:child_process` (8 sites)
- `node:os` (warnings — for `homedir()`)
- ~80 `process.exit(...)` (warnings — handled correctly by `streamCommander`)

## Why the scanner is wrong (for these cases)

Workerd's `nodejs_compat` provides **stub modules** for `fs`, `child_process`, `os`, `path`, etc. They satisfy `require()` and `import` resolution; their methods throw "not implemented" only when actually invoked. Many libraries import these modules at the top of files but only call into them on specific code paths.

In firecrawl-cli's case:
- `commands/scrape.js` imports `fs` for the `--output <file>` write path. If you call `scrape <url>` without `--output`, `fs` is never touched.
- `commands/browser.js` imports `child_process` for launching local Chromium. If you never call `browser`, `child_process` is never touched.
- `--help` and `--version` don't exercise any of these.

The scanner's `ERROR L12 require("fs")` flags the import, not the call. A more honest scanner would only flag *runtime calls* — but pattern-matching for `fs.readFileSync(`, `spawn(`, etc. is much noisier and easier to miss. The conservative report is what you get from a static scan.

**Rule of thumb: treat scanner errors as "this code path may break if exercised." A clean scan is necessary but not sufficient; a noisy scan means inspect what's actually called.**

## What did block — and how to work around it

### 1. Auto-parse on import

`firecrawl-cli/dist/index.js` ends with:

```js
async function main() {
  // ...
  await program.parseAsync(modifiedArgv);  // or .parseAsync() bare
}
main().catch(...);
```

`main()` runs at module load. Importing the package triggers parsing against whatever `process.argv` the host has — which is rarely meaningful, often an interactive auth prompt (if argv is empty), and never under our control.

**Workaround:** monkey-patch `Command.prototype.parseAsync` on firecrawl's nested commander **before** importing the module. On the first call (firecrawl's `main()`), capture `this` (the program) and return immediately. The auto-parse becomes a no-op:

```ts
const origParseAsync = Command.prototype.parseAsync;
let capturedProgram: Command | null = null;
Command.prototype.parseAsync = async function (this: Command, ...args: unknown[]) {
  if (capturedProgram === null) {
    capturedProgram = this;
    return this;
  }
  return origParseAsync.apply(this, args);
};
await import("firecrawl-cli/dist/index.js");
// capturedProgram is now usable.
```

### 2. The interactive auth flow

When `process.argv` is empty (just `["bun", "script.ts"]`), `main()` takes the "no args" branch and runs `@inquirer/prompts`, hanging on stdin. Plant a non-empty argv so `parseAsync` is the branch hit instead:

```ts
process.argv = [process.argv[0] ?? "bun", "firecrawl", "--help"];
process.env.FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY ?? "noop";
```

### 3. Nested commander instance

firecrawl-cli bundles its own commander (v14, in `node_modules/firecrawl-cli/node_modules/commander/`) alongside whatever top-level commander you've got. To patch the same prototype firecrawl will use, resolve commander **relative to firecrawl-cli**:

```ts
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const fcCommanderPath = require.resolve("commander", {
  paths: [require.resolve("firecrawl-cli")],
});
const { Command } = require(fcCommanderPath);
```

This puts the right module instance in the CJS require cache so when firecrawl-cli does `require("commander")` from its own context, it finds the prototype you just patched.

## What this exercise demonstrates

Three takeaways:

1. **The scanner is a pre-flight smell test, not a verdict.** For a package like firecrawl-cli that imports lots of Node-only modules at file scope but only calls into them on specific code paths, treat the error count as "things to look at," not "things that will break." Run the actual code in a worker to find out what actually fails.

2. **CLIs that auto-parse on import need a small adapter, not a fork.** A 10-line `parseAsync` monkey-patch turns any "executable-shaped" Commander CLI into a library — no upstream changes required.

3. **mirage-commander's runtime is unaffected by the static scanner's verdict.** `streamCommander` and `runCommander` don't care what the CLI imports; they only care what it writes to stdout/stderr, whether it reads stdin, and what exit code it produces. If the action's hot path never calls `fs.readFileSync`, neither does the wrapped CLI.

## When the scanner is right

The compat scanner does correctly flag patterns that would always break if any path through the wrapped code reaches them — top-level execution of `process.chdir()`, `eval()`, `new Function()`, raw socket calls. For firecrawl-cli specifically, all the flagged errors are dormant-on-import.

For a CLI where the offending code is in the module-init path (e.g., reads a config file at top level to register subcommands), the scanner's errors would actually correspond to "broken on import." That's a real worker-incompat case the scanner catches honestly.
