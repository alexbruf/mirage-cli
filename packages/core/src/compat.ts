/**
 * Best-effort static scan for things that break on Cloudflare Workers.
 *
 * Commander 12 wraps user action handlers in a closure, so a built `Command`
 * doesn't expose the user's original source to `.toString()`. Pass the CLI's
 * source code as a string instead (read the file with whatever loader you
 * already have).
 *
 * Approximate by design — minified/obfuscated source will hide pattern hits,
 * and dynamic imports may sneak past. A clean report is necessary, not
 * sufficient. Pair with a real deploy + smoke test.
 */

export interface CompatIssue {
  severity: "error" | "warn";
  pattern: string;
  hint: string;
  /** 1-indexed line number in the scanned source. */
  line: number;
}

export interface CompatReport {
  ok: boolean;
  errors: number;
  warnings: number;
  issues: readonly CompatIssue[];
}

interface Check {
  pattern: RegExp;
  severity: "error" | "warn";
  hint: string;
}

const CHECKS: readonly Check[] = [
  { pattern: /(?:require\s*\(\s*|from\s+)["'](?:node:)?(?:fs|fs\/promises)["']/, severity: "error",
    hint: "node:fs unavailable on CF Workers; use R2/KV/D1 or in-memory inputs" },
  { pattern: /(?:require\s*\(\s*|from\s+)["'](?:node:)?child_process["']/, severity: "error",
    hint: "child_process not supported on CF Workers" },
  { pattern: /(?:require\s*\(\s*|from\s+)["'](?:node:)?(?:net|dgram|cluster|worker_threads|tls|dns)["']/, severity: "error",
    hint: "raw sockets / threads / dns unsupported on CF Workers; use fetch()" },
  { pattern: /(?:require\s*\(\s*|from\s+)["'](?:node:)?os["']/, severity: "warn",
    hint: "node:os is partial on CF Workers; many fields throw" },
  { pattern: /(?:require\s*\(\s*|from\s+)["'](?:node:)?(?:repl|vm|inspector)["']/, severity: "error",
    hint: "node:repl / vm / inspector unsupported on CF Workers" },
  { pattern: /\bprocess\.exit\s*\(/, severity: "warn",
    hint: "process.exit is intercepted by captureStdio but indicates flow that may not survive on workers" },
  { pattern: /\b__dirname\b/, severity: "warn", hint: "__dirname is not meaningful on CF Workers" },
  { pattern: /\b__filename\b/, severity: "warn", hint: "__filename is not meaningful on CF Workers" },
  { pattern: /\beval\s*\(/, severity: "error", hint: "eval is blocked on CF Workers" },
  { pattern: /\bnew\s+Function\s*\(/, severity: "error", hint: "new Function() is blocked on CF Workers" },
  { pattern: /\bprocess\.chdir\s*\(/, severity: "error", hint: "process.chdir is not supported on CF Workers" },
  { pattern: /\bprocess\.cwd\s*\(/, severity: "warn", hint: "process.cwd may return a stub on CF Workers" },
  { pattern: /\bBuffer\.allocUnsafeSlow\b/, severity: "warn", hint: "Buffer.allocUnsafeSlow may not exist on CF Workers" },
];

export function checkCompatSource(source: string): CompatReport {
  const issues: CompatIssue[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (isCommentOnly(line)) continue;
    for (const c of CHECKS) {
      const m = line.match(c.pattern);
      if (m) issues.push({ severity: c.severity, pattern: m[0], hint: c.hint, line: i + 1 });
    }
  }
  const errors = issues.filter((i) => i.severity === "error").length;
  return { ok: errors === 0, errors, warnings: issues.length - errors, issues };
}

function isCommentOnly(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

export function formatReport(r: CompatReport): string {
  if (r.issues.length === 0) return "OK: no CF Worker compatibility issues detected (static scan only).";
  const lines: string[] = [];
  for (const i of r.issues) {
    const tag = i.severity === "error" ? "ERROR" : "WARN ";
    lines.push(`${tag} L${i.line}  ${i.pattern}`);
    lines.push(`        ${i.hint}`);
  }
  lines.push("");
  lines.push(`${r.errors} error(s), ${r.warnings} warning(s).`);
  return lines.join("\n");
}
