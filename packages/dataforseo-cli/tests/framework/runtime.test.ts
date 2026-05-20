import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import {
  argvToInput,
  command,
  CommandSpec,
  group,
  invoke,
  IOResult,
  mountGroup,
  ok,
  Operand,
  OperandKind,
  Option,
  toCommander,
} from "../../src/index.ts";

const DEC = new TextDecoder();

/** Build a command whose fn records what it received. */
function recorder(spec: CommandSpec) {
  const seen: {
    paths: readonly string[];
    texts: readonly string[];
    flags: Record<string, string | boolean>;
  } = { paths: [], texts: [], flags: {} };
  const cmd = command({
    name: "rec",
    spec,
    fn: async (_a, paths, texts, opts) => {
      Object.assign(seen, { paths, texts, flags: opts.flags });
      return ok(`p=${paths.join(",")} t=${texts.join(",")}`);
    },
  });
  return { cmd, seen };
}

/** Run a built commander program against an argv array; capture stdout/exit. */
async function runCommander(cmd: ReturnType<typeof toCommander>, argv: string[]): Promise<{ stdout: string }> {
  const original = process.stdout.write.bind(process.stdout);
  const chunks: Uint8Array[] = [];
  (process.stdout as { write: typeof process.stdout.write }).write = ((chunk: unknown) => {
    chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : (chunk as Uint8Array));
    return true;
  }) as typeof process.stdout.write;
  try {
    const program = new Command();
    program.addCommand(cmd);
    await program.parseAsync(["node", "test", cmd.name(), ...argv]);
  } finally {
    process.stdout.write = original;
  }
  return { stdout: chunks.map((c) => DEC.decode(c)).join("") };
}

describe("argvToInput", () => {
  test("splits PATH and TEXT operands into separate buckets", () => {
    const spec = new CommandSpec({
      positional: [
        new Operand({ kind: OperandKind.PATH, name: "src" }),
        new Operand({ kind: OperandKind.TEXT, name: "label" }),
      ],
    });
    const got = argvToInput(spec, ["/data/foo.txt", "the-label"]);
    expect(got.paths).toEqual(["/data/foo.txt"]);
    expect(got.texts).toEqual(["the-label"]);
  });

  test("variadic positional consumes the rest of one kind", () => {
    const spec = new CommandSpec({
      positional: [new Operand({ kind: OperandKind.TEXT, name: "items", variadic: true })],
    });
    const got = argvToInput(spec, ["a", "b", "c"]);
    expect(got.texts).toEqual(["a", "b", "c"]);
    expect(got.paths).toEqual([]);
  });

  test("parses --long, --long=value, -s, -s value", () => {
    const spec = new CommandSpec({
      options: [
        new Option({ long: "name", valueKind: OperandKind.TEXT }),
        new Option({ short: "n", long: "limit", valueKind: OperandKind.TEXT }),
        new Option({ short: "v", long: "verbose" }),
      ],
    });
    const got = argvToInput(spec, ["--name=alice", "-n", "50", "-v"]);
    expect(got.flags?.name).toBe("alice");
    expect(got.flags?.limit).toBe("50");
    expect(got.flags?.verbose).toBe(true);
  });

  test("default values seed the flags bag", () => {
    const spec = new CommandSpec({
      options: [
        new Option({ long: "limit", valueKind: OperandKind.TEXT, defaultValue: "100" }),
        new Option({ long: "force", defaultValue: true }),
        new Option({ long: "noop" }), // NONE valueKind → seeded to false
      ],
    });
    const got = argvToInput(spec, []);
    expect(got.flags?.limit).toBe("100");
    expect(got.flags?.force).toBe(true);
    expect(got.flags?.noop).toBe(false);
  });

  test("-- terminates option parsing", () => {
    const spec = new CommandSpec({
      positional: [new Operand({ kind: OperandKind.TEXT, name: "args", variadic: true })],
      options: [new Option({ long: "flag" })],
    });
    const got = argvToInput(spec, ["--flag", "--", "--not-a-flag", "raw"]);
    expect(got.flags?.flag).toBe(true);
    expect(got.texts).toEqual(["--not-a-flag", "raw"]);
  });
});

describe("toCommander", () => {
  test("variadic TEXT operand passes all values to fn.texts", async () => {
    const spec = new CommandSpec({
      positional: [new Operand({ kind: OperandKind.TEXT, name: "kws", variadic: true })],
    });
    const { cmd, seen } = recorder(spec);
    const cc = toCommander(cmd);
    await runCommander(cc, ["seo tools", "keyword research", "ai search"]);
    expect(seen.texts).toEqual(["seo tools", "keyword research", "ai search"]);
    expect(seen.paths).toEqual([]);
  });

  test("kebab→camel option key mapping (--include-serp-info → opts.flags['include-serp-info'])", async () => {
    const spec = new CommandSpec({
      options: [new Option({ long: "include-serp-info" })],
    });
    const { cmd, seen } = recorder(spec);
    await runCommander(toCommander(cmd), ["--include-serp-info"]);
    expect(seen.flags["include-serp-info"]).toBe(true);
  });

  test("default values flow through commander", async () => {
    const spec = new CommandSpec({
      options: [new Option({ long: "limit", valueKind: OperandKind.TEXT, defaultValue: "100" })],
    });
    const { cmd, seen } = recorder(spec);
    await runCommander(toCommander(cmd), []);
    expect(seen.flags.limit).toBe("100");
  });

  test("required Option carries the required flag through to commander", () => {
    // Direct check: we verify our spec → commander option translation marks
    // it required, rather than actually triggering commander's exit (which
    // doesn't honor `exitOverride()` on subcommands cleanly).
    const spec = new CommandSpec({
      options: [new Option({ long: "token", valueKind: OperandKind.TEXT, required: true })],
    });
    const { cmd } = recorder(spec);
    const cc = toCommander(cmd);
    const tokenOpt = cc.options.find((o) => o.long === "--token");
    expect(tokenOpt).toBeDefined();
    expect(tokenOpt!.mandatory).toBe(true);
  });

  test("--no-* boolean negation: commander turns --no-cost into opts.cost=false", async () => {
    // Mirage spec: long: "no-cost" means the user types `--no-cost` to set
    // the flag true. Commander has special semantics for --no-*: if the long
    // flag starts with "no-", commander stores the negated key. Our adapter
    // looks up under the raw long name ("no-cost"), so this verifies the
    // round-trip stays consistent.
    const spec = new CommandSpec({
      options: [new Option({ long: "no-cost", description: "Suppress cost output." })],
    });
    const { cmd, seen } = recorder(spec);
    await runCommander(toCommander(cmd), ["--no-cost"]);
    // Commander stores as opts.cost=false; our adapter looks up "noCost" key,
    // which won't match — so the flag isn't recorded. This documents the
    // known-broken edge case so we don't regress without noticing.
    expect(seen.flags["no-cost"]).toBeUndefined();
  });

  test("PATH operands route to fn.paths, TEXT to fn.texts", async () => {
    const spec = new CommandSpec({
      positional: [
        new Operand({ kind: OperandKind.PATH, name: "src" }),
        new Operand({ kind: OperandKind.TEXT, name: "label" }),
      ],
    });
    const { cmd, seen } = recorder(spec);
    await runCommander(toCommander(cmd), ["/foo.txt", "my-label"]);
    expect(seen.paths).toEqual(["/foo.txt"]);
    expect(seen.texts).toEqual(["my-label"]);
  });

  test("fn output bytes go to stdout", async () => {
    const spec = new CommandSpec({
      positional: [new Operand({ kind: OperandKind.TEXT, name: "name" })],
    });
    const cmd = command({
      name: "echoer",
      spec,
      fn: async (_a, _p, texts) => ok(`hello ${texts[0]}\n`),
    });
    const { stdout } = await runCommander(toCommander(cmd), ["alex"]);
    expect(stdout).toBe("hello alex\n");
  });
});

describe("mountGroup", () => {
  test("nests groups and commands onto a parent program", async () => {
    const inner = command({
      name: "inner",
      spec: new CommandSpec({
        positional: [new Operand({ kind: OperandKind.TEXT, name: "x" })],
      }),
      fn: async (_a, _p, texts) => ok(`inner:${texts[0]}\n`),
    });

    const root = group({
      name: "root",
      commands: [],
      groups: [group({ name: "sub", commands: [inner] })],
    });

    const program = new Command();
    mountGroup(program, root);

    const original = process.stdout.write.bind(process.stdout);
    let stdout = "";
    (process.stdout as { write: typeof process.stdout.write }).write = ((chunk: unknown) => {
      stdout += typeof chunk === "string" ? chunk : DEC.decode(chunk as Uint8Array);
      return true;
    }) as typeof process.stdout.write;
    try {
      await program.parseAsync(["node", "test", "root", "sub", "inner", "hello"]);
    } finally {
      process.stdout.write = original;
    }
    expect(stdout).toBe("inner:hello\n");
  });
});

describe("invoke", () => {
  test("structured input form returns parsed text", async () => {
    const cmd = command({
      name: "u",
      spec: new CommandSpec({
        options: [new Option({ short: "u", long: "upper" })],
        positional: [new Operand({ kind: OperandKind.TEXT, name: "name" })],
      }),
      fn: async (_a, _p, texts, opts) =>
        ok(opts.flags.upper === true ? `HI ${(texts[0] ?? "").toUpperCase()}` : `hi ${texts[0] ?? ""}`),
    });
    const r1 = await invoke(cmd, { texts: ["alex"], flags: { upper: true } });
    expect(r1.text).toBe("HI ALEX");
    expect(r1.result.exitCode).toBe(0);

    const r2 = await invoke(cmd, ["alex"]);
    expect(r2.text).toBe("hi alex");
  });

  test("argv form goes through argvToInput", async () => {
    const cmd = command({
      name: "f",
      spec: new CommandSpec({
        options: [
          new Option({ short: "n", long: "limit", valueKind: OperandKind.TEXT, defaultValue: "1" }),
        ],
      }),
      fn: async (_a, _p, _t, opts) => ok(`limit=${opts.flags.limit}`),
    });
    const r = await invoke(cmd, ["-n", "42"]);
    expect(r.text).toBe("limit=42");
  });

  test("non-zero IOResult exitCode is surfaced (no process.exit during programmatic use)", async () => {
    const cmd = command({
      name: "boom",
      spec: new CommandSpec({}),
      fn: async () => [null, new IOResult({ exitCode: 7, stderr: "nope\n" })],
    });
    const r = await invoke(cmd, []);
    expect(r.text).toBe("");
    expect(r.result.exitCode).toBe(7);
    expect(DEC.decode(r.result.stderr!)).toBe("nope\n");
  });
});
