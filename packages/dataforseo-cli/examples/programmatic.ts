/**
 * Three ways to call DataForSEO programmatically.
 *
 *   bun run examples/programmatic.ts
 *
 * Set DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD before running.
 */

// 1. Plain async API — typed, returns the raw DfsResponse.
import { keywordsSearchVolume } from "../src/index.ts";

const directly = await keywordsSearchVolume({
  keywords: ["seo tools", "keyword research"],
  locationName: "United States",
});
console.log(`got ${directly.tasks?.length ?? 0} tasks back, cost: $${directly.cost ?? 0}`);

// 2. Mirage-shape command — invoke() handles arg/flag parsing without spawning.
import { invoke, keywordsSearchVolumeCmd } from "../src/index.ts";

const viaCommand = await invoke(keywordsSearchVolumeCmd, {
  texts: ["seo tools", "keyword research"],
  flags: { location: "United States", output: "table" },
});
console.log(viaCommand.text);
console.log(`exit code: ${viaCommand.result.exitCode}`);

// 3. Author your own command with the same primitives.
import {
  command,
  CommandSpec,
  IOResult,
  Operand,
  OperandKind,
  Option,
} from "../src/index.ts";

const greet = command({
  name: "greet",
  resource: "ram",
  spec: new CommandSpec({
    description: "Print hello <name>.",
    options: [new Option({ short: "u", long: "upper", description: "shout it" })],
    positional: [new Operand({ kind: OperandKind.TEXT, name: "name" })],
  }),
  async fn(_acc, _paths, texts, opts) {
    const name = texts[0] ?? "world";
    const upper = opts.flags.upper === true;
    const msg = upper ? `HELLO ${name.toUpperCase()}!\n` : `hello ${name}\n`;
    return [new TextEncoder().encode(msg), new IOResult({ exitCode: 0 })];
  },
});

const result = await invoke(greet, { texts: ["alex"], flags: { upper: true } });
process.stdout.write(result.text);
