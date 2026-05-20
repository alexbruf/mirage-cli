#!/usr/bin/env bun
/**
 * Drive the wrangler-dev @mirage-cli/core worker over HTTP and report results.
 * Assumes `wrangler dev --port 3003` is already running.
 */

interface Case {
  name: string;
  argv: string[];
  expect: (out: string, status: number, headers: Headers) => string | null;
}

const dec = new TextDecoder();

const cases: Case[] = [
  {
    name: "greet world",
    argv: ["greet", "world"],
    expect: (out, status) => {
      if (status !== 200) return `status ${status}`;
      if (out.trim() !== "hello world") return `unexpected stdout: ${out!.slice(0, 80)}`;
      return null;
    },
  },
  {
    name: "greet world --loud",
    argv: ["greet", "world", "--loud"],
    expect: (out, status) => {
      if (status !== 200) return `status ${status}`;
      if (out.trim() !== "HELLO WORLD") return `unexpected stdout: ${out!.slice(0, 80)}`;
      return null;
    },
  },
  {
    name: "count 3 (process.stdout.write)",
    argv: ["count", "3"],
    expect: (out) => out === "1\n2\n3\n" ? null : `unexpected stdout: ${JSON.stringify(out)}`,
  },
  {
    name: "fail (process.exit 2)",
    argv: ["fail"],
    expect: (_out, status, headers) => {
      if (status !== 500) return `status ${status} (expected 500)`;
      if (headers.get("x-exit-code") !== "2") return `x-exit-code ${headers.get("x-exit-code")} (expected 2)`;
      const stderr = headers.get("x-stderr") ?? "";
      if (!stderr.includes("kaboom")) return `stderr missing kaboom: ${stderr}`;
      return null;
    },
  },
  {
    name: "--help",
    argv: ["--help"],
    expect: (out, status) => {
      if (status !== 200) return `status ${status}`;
      if (!out.includes("workerd smoke")) return "help missing description";
      if (!out.includes("greet")) return "help missing subcommand";
      return null;
    },
  },
  {
    name: "--version",
    argv: ["--version"],
    expect: (out, status) => {
      if (status !== 200) return `status ${status}`;
      if (out.trim() !== "0.1.0") return `version: ${out.trim()}`;
      return null;
    },
  },
  {
    name: "unknown option",
    argv: ["greet", "--nope"],
    expect: (_out, status, headers) => {
      if (status === 200) return "expected non-200";
      const code = Number(headers.get("x-exit-code"));
      if (!Number.isInteger(code) || code === 0) return `bad exit code ${code}`;
      return null;
    },
  },
];

let pass = 0, fail = 0;
for (const c of cases) {
  let res: Response;
  try {
    res = await fetch("http://localhost:3003/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ argv: c.argv }),
    });
  } catch (e) {
    console.log(`FAIL  ${c.name}\n        fetch error: ${e}`);
    fail++;
    continue;
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const body = dec.decode(buf);
  const err = c.expect(body, res.status, res.headers);
  if (err) {
    console.log(`FAIL  ${c.name}\n        ${err}`);
    fail++;
  } else {
    console.log(`PASS  ${c.name}`);
    pass++;
  }
}

// Streaming check: read the response stream chunk by chunk and verify bytes
// arrive incrementally rather than all at once.
{
  const t0 = Date.now();
  const res = await fetch("http://localhost:3003/stream", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept-encoding": "identity", // disable workerd gzip → keeps streaming
    },
    body: JSON.stringify({ argv: ["drip", "4"] }),
  });
  if (!res.body) {
    console.log("FAIL  stream drip 4\n        no response body");
    fail++;
  } else {
    const reader = res.body.getReader();
    const arrivals: { line: string; at: number }[] = [];
    let leftover = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const text = leftover + dec.decode(value);
      const lines = text.split("\n");
      leftover = lines.pop() ?? "";
      for (const line of lines) if (line) arrivals.push({ line, at: Date.now() - t0 });
    }
    if (arrivals.length !== 4) {
      console.log(`FAIL  stream drip 4\n        expected 4 lines, got ${arrivals.length}: ${JSON.stringify(arrivals)}`);
      fail++;
    } else {
      // Lines should be spaced ~50ms apart in the worker. Even with batching,
      // the last arrival should be > 50ms after the first.
      const spread = arrivals[arrivals.length - 1]!.at - arrivals[0]!.at;
      if (spread < 30) {
        console.log(`FAIL  stream drip 4\n        all 4 lines arrived in ${spread}ms (looks buffered, not streamed)`);
        fail++;
      } else {
        console.log(`PASS  stream drip 4 (4 lines over ${spread}ms)`);
        pass++;
      }
    }
  }
}

// Stdin streaming check: send a request body, expect the wrapped action to
// receive it as process.stdin and echo back uppercased.
{
  const res = await fetch("http://localhost:3003/stdin?argv=upper-stdin", {
    method: "POST",
    headers: { "accept-encoding": "identity" },
    body: "hello workerd",
  });
  const out = await res.text();
  if (out === "HELLO WORKERD") {
    console.log("PASS  stdin upper-stdin");
    pass++;
  } else {
    console.log(`FAIL  stdin upper-stdin\n        got ${JSON.stringify(out)}`);
    fail++;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

export {};
