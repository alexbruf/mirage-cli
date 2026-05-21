import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { runCommander, streamCommander, toMirageCommandFn } from "../src/runner.ts";
import { checkCompatSource } from "../src/compat.ts";

function buildSampleProgram(): Command {
  const program = new Command();
  program.name("sample").version("1.2.3").description("sample CLI");

  program
    .command("greet")
    .description("say hi")
    .argument("<name>")
    .option("-l, --loud", "shout")
    .action((name: string, opts: { loud?: boolean }) => {
      const msg = `hello ${name}`;
      console.log(opts.loud ? msg.toUpperCase() : msg);
    });

  program
    .command("fail")
    .description("always fails")
    .action(() => {
      console.error("kaboom");
      process.exit(2);
    });

  program
    .command("count")
    .argument("<n>")
    .action((nStr: string) => {
      const n = Number(nStr);
      for (let i = 1; i <= n; i++) process.stdout.write(`${i}\n`);
    });

  return program;
}

const dec = new TextDecoder();

describe("runCommander", () => {
  test("captures console.log from action", async () => {
    const r = await runCommander(buildSampleProgram(), ["greet", "world"]);
    expect(dec.decode(r.stdout).trim()).toBe("hello world");
    expect(r.exitCode).toBe(0);
    expect(dec.decode(r.stderr)).toBe("");
  });

  test("respects boolean flag", async () => {
    const r = await runCommander(buildSampleProgram(), ["greet", "world", "--loud"]);
    expect(dec.decode(r.stdout).trim()).toBe("HELLO WORLD");
  });

  test("routes process.exit through exitCode", async () => {
    const r = await runCommander(buildSampleProgram(), ["fail"]);
    expect(r.exitCode).toBe(2);
    expect(dec.decode(r.stderr)).toContain("kaboom");
  });

  test("captures process.stdout.write", async () => {
    const r = await runCommander(buildSampleProgram(), ["count", "3"]);
    expect(dec.decode(r.stdout)).toBe("1\n2\n3\n");
  });

  test("--help emits help to stdout with exitCode 0", async () => {
    const r = await runCommander(buildSampleProgram(), ["--help"]);
    expect(r.exitCode).toBe(0);
    expect(dec.decode(r.stdout)).toContain("sample CLI");
    expect(dec.decode(r.stdout)).toContain("greet");
  });

  test("subcommand --help works", async () => {
    const r = await runCommander(buildSampleProgram(), ["greet", "--help"]);
    expect(r.exitCode).toBe(0);
    expect(dec.decode(r.stdout)).toContain("say hi");
  });

  test("unknown option lands as non-zero exit", async () => {
    const r = await runCommander(buildSampleProgram(), ["greet", "--nope"]);
    expect(r.exitCode).not.toBe(0);
  });

  test("--version writes version", async () => {
    const r = await runCommander(buildSampleProgram(), ["--version"]);
    expect(dec.decode(r.stdout).trim()).toBe("1.2.3");
    expect(r.exitCode).toBe(0);
  });

  // Regression: leaf-subcommand --help must not fall through to the action
  // handler. Bug surfaced in vendored ahrefs/dataforseo CLIs that use
  // `.addCommand()` for groups + leaves; commander v14's `_exit()` does not
  // walk the parent chain to find an inherited `_exitCallback`, and in
  // workerd `process.exit` can't be patched, so the leaf's action would
  // fire (with no args) and hang forever inside an API call.
  test("nested-subcommand --help does NOT trigger the leaf action", async () => {
    const program = new Command();
    program.name("nested").version("9.9.9").description("nested cli");

    const group = new Command("group").description("a group");
    const leaf = new Command("leaf")
      .description("a leaf that would hang if reached")
      .action(async () => {
        // If this runs, the test deadlocks — that's the bug.
        await new Promise(() => {});
      });
    group.addCommand(leaf);
    program.addCommand(group);

    const r = await runCommander(program, ["group", "leaf", "--help"]);
    expect(r.exitCode).toBe(0);
    expect(dec.decode(r.stdout)).toContain("a leaf that would hang");
  });
});

describe("streamCommander", () => {
  test("returns a ReadableStream that yields chunks as the action writes", async () => {
    const program = new Command();
    program.command("drip")
      .argument("<n>")
      .action(async (nStr: string) => {
        const n = Number(nStr);
        for (let i = 1; i <= n; i++) {
          process.stdout.write(`tick-${i}\n`);
          await new Promise<void>((r) => setTimeout(r, 5));
        }
      });

    const s = streamCommander(program, ["drip", "3"]);
    const reader = s.stdout.getReader();
    const seen: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) seen.push(dec.decode(value));
    }
    const final = await s.done;
    expect(final.exitCode).toBe(0);
    expect(seen.join("")).toBe("tick-1\ntick-2\ntick-3\n");
    expect(seen.length).toBeGreaterThanOrEqual(1);
  });

  test("done resolves with non-zero exitCode on process.exit", async () => {
    const program = new Command();
    program.command("bail").action(() => {
      process.stderr.write("nope\n");
      process.exit(7);
    });
    const s = streamCommander(program, ["bail"]);
    const errBytes = await new Response(s.stderr).arrayBuffer();
    const final = await s.done;
    expect(final.exitCode).toBe(7);
    expect(dec.decode(new Uint8Array(errBytes))).toContain("nope");
  });
});

describe("stdin", () => {
  function buildEcho(): Command {
    const program = new Command();
    program.command("echo-stdin")
      .description("read stdin, write it back uppercased")
      .action(async () => {
        const stdin = process.stdin as unknown as AsyncIterable<Uint8Array>;
        const chunks: Uint8Array[] = [];
        for await (const c of stdin) chunks.push(c);
        const total = chunks.reduce((a, b) => a + b.length, 0);
        const merged = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { merged.set(c, off); off += c.length; }
        process.stdout.write(new TextDecoder().decode(merged).toUpperCase());
      });
    return program;
  }

  test("accepts Uint8Array stdin", async () => {
    const r = await runCommander(buildEcho(), ["echo-stdin"], {
      stdin: new TextEncoder().encode("hello"),
    });
    expect(r.exitCode).toBe(0);
    expect(dec.decode(r.stdout)).toBe("HELLO");
  });

  test("accepts AsyncIterable stdin (streaming input)", async () => {
    async function* gen() {
      yield new TextEncoder().encode("hel");
      yield new TextEncoder().encode("lo wo");
      yield new TextEncoder().encode("rld");
    }
    const r = await runCommander(buildEcho(), ["echo-stdin"], { stdin: gen() });
    expect(dec.decode(r.stdout)).toBe("HELLO WORLD");
  });
});

describe("toMirageCommandFn", () => {
  test("matches mirage CommandFn signature; argv via texts, stdin via opts", async () => {
    const program = new Command();
    program.command("upper")
      .action(async () => {
        const stdin = process.stdin as unknown as AsyncIterable<Uint8Array>;
        const chunks: Uint8Array[] = [];
        for await (const c of stdin) chunks.push(c);
        const text = chunks.map((c) => dec.decode(c)).join("");
        process.stdout.write(text.toUpperCase());
      });

    const fn = toMirageCommandFn(program);
    const [stdout, io] = await fn(
      null, // accessor
      [],   // paths
      ["upper"], // texts === argv
      { stdin: new TextEncoder().encode("hi") },
    );
    // Drain stdout (ReadableStream → bytes)
    const stdoutBytes = await new Response(stdout as unknown as ReadableStream).arrayBuffer();
    expect(dec.decode(new Uint8Array(stdoutBytes))).toBe("HI");
    expect(io.exitCode).toBe(0);
    expect(io.reads).toEqual({});
    expect(io.writes).toEqual({});
  });

  // Feature: bare command name (no subcommand) should default to --help so
  // agents calling e.g. `bash 'pulse'` see something useful on stdout instead
  // of an empty exit-1 from commander's "missing command" path.
  test("empty texts defaults to --help (exit 0, help text on stdout)", async () => {
    const program = new Command();
    program.name("demo").description("demo CLI for empty-argv default");
    program.command("greet").action(() => { process.stdout.write("hello\n"); });
    program.command("fail").action(() => { process.exit(2); });

    const fn = toMirageCommandFn(program);
    const [stdout, io] = await fn(null, [], [] /* no texts */, { stdin: null, flags: {} });
    const stdoutBytes = await new Response(stdout as unknown as ReadableStream).arrayBuffer();
    const text = dec.decode(new Uint8Array(stdoutBytes));
    expect(io.exitCode).toBe(0);
    expect(text).toContain("demo CLI for empty-argv default");
    expect(text).toContain("greet");
    expect(text).toContain("fail");
  });
});

describe("concurrent runs", () => {
  function buildLabeledDrip(label: string): Command {
    const program = new Command();
    program.command("drip")
      .argument("<n>")
      .action(async (nStr: string) => {
        const n = Number(nStr);
        for (let i = 1; i <= n; i++) {
          process.stdout.write(`${label}-${i}\n`);
          await new Promise<void>((r) => setTimeout(r, 5));
        }
      });
    return program;
  }

  test("two simultaneous streamCommander calls don't interleave stdout", async () => {
    const [a, b] = await Promise.all([
      runCommander(buildLabeledDrip("a"), ["drip", "5"]),
      runCommander(buildLabeledDrip("b"), ["drip", "5"]),
    ]);
    expect(dec.decode(a.stdout)).toBe("a-1\na-2\na-3\na-4\na-5\n");
    expect(dec.decode(b.stdout)).toBe("b-1\nb-2\nb-3\nb-4\nb-5\n");
    expect(a.exitCode).toBe(0);
    expect(b.exitCode).toBe(0);
  });

  test("concurrent process.exit codes don't cross between calls", async () => {
    function buildExit(code: number): Command {
      const program = new Command();
      program.command("bail")
        .action(async () => {
          // Different sleep per call so they finish in a different order than they start.
          await new Promise<void>((r) => setTimeout(r, code));
          process.exit(code);
        });
      return program;
    }
    const results = await Promise.all([
      runCommander(buildExit(2), ["bail"]),
      runCommander(buildExit(7), ["bail"]),
      runCommander(buildExit(3), ["bail"]),
    ]);
    expect(results[0]!.exitCode).toBe(2);
    expect(results[1]!.exitCode).toBe(7);
    expect(results[2]!.exitCode).toBe(3);
  });

  test("concurrent stdin streams are routed to the right call", async () => {
    function buildEcho(): Command {
      const program = new Command();
      program.command("echo")
        .action(async () => {
          const stdin = process.stdin as unknown as AsyncIterable<Uint8Array>;
          const chunks: Uint8Array[] = [];
          for await (const c of stdin) chunks.push(c);
          const text = chunks.map((c) => dec.decode(c)).join("");
          process.stdout.write(text);
        });
      return program;
    }

    async function* slowStream(s: string): AsyncIterable<Uint8Array> {
      for (const ch of s) {
        yield new TextEncoder().encode(ch);
        await new Promise<void>((r) => setTimeout(r, 2));
      }
    }

    const [a, b] = await Promise.all([
      runCommander(buildEcho(), ["echo"], { stdin: slowStream("hello") }),
      runCommander(buildEcho(), ["echo"], { stdin: slowStream("world") }),
    ]);
    expect(dec.decode(a.stdout)).toBe("hello");
    expect(dec.decode(b.stdout)).toBe("world");
  });

  test("console.log outside a wrapped call still goes to the real console", () => {
    // After at least one streamCommander call, console.* is permanently patched.
    // Outside an active call, the patch must fall through to the original.
    // We can't easily intercept process.stdout here, so just assert it doesn't throw
    // and doesn't appear in any closed writer.
    expect(() => {
      console.log("fallthrough check — should print normally");
    }).not.toThrow();
  });
});

describe("checkCompatSource", () => {
  test("clean source has no issues", () => {
    const src = `
      import { Command } from "commander";
      const p = new Command();
      p.command("greet").action((n) => console.log("hi " + n));
    `;
    expect(checkCompatSource(src).errors).toBe(0);
  });

  test("flags fs / child_process imports", () => {
    const src = `
      import fs from "node:fs";
      import { spawn } from "child_process";
      const data = fs.readFileSync("x");
    `;
    const r = checkCompatSource(src);
    expect(r.ok).toBe(false);
    expect(r.errors).toBeGreaterThanOrEqual(2);
    expect(r.issues.some((i: { pattern: string }) => /fs/.test(i.pattern))).toBe(true);
    expect(r.issues.some((i: { pattern: string }) => /child_process/.test(i.pattern))).toBe(true);
  });

  test("warns on __dirname", () => {
    const r = checkCompatSource(`const p = __dirname + "/data";`);
    expect(r.warnings).toBeGreaterThanOrEqual(1);
  });
});
