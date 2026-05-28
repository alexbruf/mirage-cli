/**
 * Build a mirage-compatible command from an OpenAPI spec entry.
 *
 * Spec → CommandSpec (options, positional, description). The command's `fn`
 * builds the request from parsed flags, calls `request()`, renders output,
 * and returns [bytes, IOResult].
 *
 * One source of truth for: CLI (via toCommander), programmatic invoke(),
 * mirage workspace lift.
 */
import { request } from "./client.ts";
import { command, ok, type CommandDef, type CommandOpts } from "./framework/runtime.ts";
import {
  CommandSpec,
  IOResult,
  Operand,
  OperandKind,
  Option,
} from "./framework/types.ts";
import { colorizeMetric, render, renderSingle } from "./output.ts";
import {
  describeEndpoint,
  getParameters,
  getRequestBodyParams,
  getResponseColumns,
  paramHelp,
  type Column,
} from "./spec.ts";
import {
  bool,
  cacheTtl,
  daysAgo,
  GLOBAL_OPTION_NAMES,
  globalOptions,
  resolveFormat,
  str,
} from "./shared.ts";

export interface BuildOpts {
  path: string;
  method?: "get" | "post";
  name: string;
  summary?: string;
  defaultSelect?: string;
  rowsKey?: string;
  single?: boolean;
  defaults?: Record<string, string>;
  positional?: string;
  bodyTransforms?: Record<string, (raw: unknown) => unknown>;
}

const ENC = new TextEncoder();

export function endpointCommand(opts: BuildOpts): CommandDef {
  const method = opts.method ?? "get";
  const params =
    method === "post"
      ? getRequestBodyParams(method, opts.path)
      : getParameters(method, opts.path);
  const columns = getResponseColumns(method, opts.path, opts.rowsKey);

  // Filter hand-coded defaultSelect against the spec's valid columns.
  if (opts.defaultSelect && columns.length > 0) {
    const valid = new Set(columns.map((c) => c.name));
    const cols = opts.defaultSelect.split(",").map((c) => c.trim());
    const filtered = cols.filter((c) => valid.has(c));
    const dropped = cols.filter((c) => !valid.has(c));
    if (dropped.length > 0 && process.env.AHREFS_CLI_DEBUG) {
      process.stderr.write(
        `[ahrefs] ${opts.name}: dropping invalid default columns: ${dropped.join(", ")}\n`,
      );
    }
    opts = { ...opts, defaultSelect: filtered.join(",") };
  }

  // Auto-pick defaultSelect if none was provided.
  if ((!opts.defaultSelect || opts.defaultSelect === "") && columns.length > 0) {
    const auto = autoSelect(columns);
    if (auto.length > 0) opts = { ...opts, defaultSelect: auto.join(",") };
  }

  // Build the spec options list: globals first, then per-spec params.
  const options: Option[] = [...globalOptions];

  for (const p of params) {
    if (p.in !== "query") continue;
    const flag = p.name.replace(/_/g, "-");
    if (GLOBAL_OPTION_NAMES.has(flag)) continue;
    if (p.name === "output") continue; // we override with --json/--csv
    const t = p.schema?.type;
    // NOTE: required `date` params are defaulted to YESTERDAY at RUN time in
    // fn() below (BLU-292), NOT here. Baking daysAgo(1) into the option's
    // static defaultValue freezes it at build time — and the program can be
    // built when the runtime clock reads epoch 0 (e.g. Cloudflare workerd
    // module init / cached program), which yields a `1969-12-31` default and
    // 0 for every site-explorer metric. Only genuinely static defaults belong
    // here.
    const rawDefault = opts.defaults?.[p.name] ?? p.schema?.default;
    options.push(
      new Option({
        long: flag,
        valueKind: t === "boolean" ? OperandKind.NONE : OperandKind.TEXT,
        description: paramHelp(p),
        defaultValue:
          rawDefault !== undefined && t !== "boolean"
            ? String(rawDefault)
            : null,
      }),
    );
  }

  // Convenience filter flags — auto-add for endpoints with a `where` param
  // and a matching response column.
  const hasWhere = params.some((p) => p.name === "where");
  const colNames = new Set(columns.map((c) => c.name));
  const convenienceFilters: {
    flag: string;
    field: string;
    op: "lte" | "gte";
  }[] = [];
  if (hasWhere) {
    if (colNames.has("difficulty"))
      convenienceFilters.push({
        flag: "max-kd",
        field: "difficulty",
        op: "lte",
      });
    if (colNames.has("keyword_difficulty"))
      convenienceFilters.push({
        flag: "max-kd",
        field: "keyword_difficulty",
        op: "lte",
      });
    if (colNames.has("volume"))
      convenienceFilters.push({ flag: "min-volume", field: "volume", op: "gte" });
    if (colNames.has("best_position"))
      convenienceFilters.push({
        flag: "max-position",
        field: "best_position",
        op: "lte",
      });
    if (colNames.has("position"))
      convenienceFilters.push({
        flag: "max-position",
        field: "position",
        op: "lte",
      });
    if (colNames.has("domain_rating"))
      convenienceFilters.push({
        flag: "min-dr",
        field: "domain_rating",
        op: "gte",
      });
  }
  const seenFilters = new Set<string>();
  for (const cf of convenienceFilters) {
    if (seenFilters.has(cf.flag)) continue;
    seenFilters.add(cf.flag);
    options.push(
      new Option({
        long: cf.flag,
        valueKind: OperandKind.TEXT,
        description: `[number] Convenience: filter ${cf.field} ${
          cf.op === "lte" ? "<=" : ">="
        } N (builds --where).`,
      }),
    );
  }

  // Positional arg (subject of the command — keywords, target, etc.)
  const positional: Operand[] = opts.positional
    ? [
        new Operand({
          name: opts.positional,
          kind: OperandKind.TEXT,
          required: false,
        }),
      ]
    : [];

  const description =
    opts.summary ?? describeEndpoint(method, opts.path).split("\n")[0] ?? opts.name;
  const longHelp = buildLongHelp(opts, columns, method, params);

  const spec = new CommandSpec({
    description,
    options,
    positional,
  });

  // The command's fn — does the actual work
  const fn = async (
    _accessor: unknown,
    _paths: readonly string[],
    texts: readonly string[],
    commandOpts: CommandOpts,
  ) => {
    // Short-circuit --help-short before any API call.
    if (bool(commandOpts, "help-short")) {
      return ok(renderShortHelp(opts, spec) + "\n");
    }

    // Resolve positional → primary param value.
    const positionalVal = opts.positional && texts.length > 0 ? texts[0] : undefined;

    const query: Record<string, string | number | boolean | undefined> = {};
    for (const p of params) {
      if (p.in !== "query") continue;
      if (p.name === "output") continue;
      const flag = p.name.replace(/_/g, "-");
      const raw = commandOpts.flags[flag];
      let v: string | number | boolean | undefined;
      if (typeof raw === "string" && raw.length > 0) v = raw;
      else if (typeof raw === "boolean") v = raw ? "true" : undefined;

      // BLU-292: default a required `date` param to YESTERDAY, resolved HERE at
      // run time (request context with a valid clock) rather than baked into
      // the option default at build time — which freezes to 1969-12-31 when the
      // program is built under a zeroed clock (workerd module init) and zeros
      // every metric. site-explorer/metrics *requires* date (omitting → 400);
      // yesterday is the freshest reliably-published snapshot. --date overrides.
      if (
        v === undefined &&
        p.required &&
        p.schema?.format === "date" &&
        opts.defaults?.[p.name] === undefined &&
        p.schema?.default === undefined
      ) {
        v = daysAgo(1);
      }

      if (p.name === opts.positional && !v && positionalVal !== undefined) {
        v = positionalVal;
      }
      if (p.name === "select" && !v && opts.defaultSelect) {
        v = opts.defaultSelect;
      }
      if (v !== undefined) query[p.name] = v;
    }

    // Merge convenience filters into `where`.
    const userFilters: unknown[] = [];
    for (const cf of convenienceFilters) {
      const v = str(commandOpts, cf.flag);
      if (v === undefined) continue;
      const n = Number(v);
      if (Number.isNaN(n)) {
        throw new Error(`--${cf.flag}: expected a number, got "${v}"`);
      }
      userFilters.push({ field: cf.field, is: [cf.op, n] });
    }
    if (userFilters.length > 0) {
      const existing = query.where ? JSON.parse(String(query.where)) : undefined;
      const all = existing ? [existing, ...userFilters] : userFilters;
      const merged = all.length === 1 ? all[0] : { and: all };
      query.where = JSON.stringify(merged);
    }

    // POST endpoints: arrays/body transforms.
    let body: Record<string, unknown> | undefined;
    if (method === "post") {
      body = {};
      for (const [k, v] of Object.entries(query)) {
        const p = params.find((p) => p.name === k);
        const isArray =
          p?.schema?.type === "array" ||
          (p?.schema as { items?: unknown } | undefined)?.items !== undefined;
        let value: unknown;
        if (isArray && typeof v === "string") {
          value = v.split(",").map((s) => s.trim());
        } else {
          value = v;
        }
        const transform = opts.bodyTransforms?.[k];
        body[k] = transform ? transform(value) : value;
      }
      for (const k of Object.keys(query)) delete query[k];
    }

    // Capture --explain output (it would go to stderr).
    const stderr: string[] = [];
    if (bool(commandOpts, "explain")) {
      const key = process.env.AHREFS_API_KEY ?? str(commandOpts, "api-key") ?? "";
      const headers = `-H 'Authorization: Bearer ${key.slice(0, 4)}…' -H 'Accept: application/json'`;
      const url = new URL(
        "https://api.ahrefs.com/v3" +
          (opts.path.startsWith("/") ? opts.path : "/" + opts.path),
      );
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null || v === "") continue;
        url.searchParams.set(k, String(v));
      }
      const bodyFlag = body ? ` -d '${JSON.stringify(body)}'` : "";
      stderr.push(
        `curl -X ${method.toUpperCase()} ${headers}${bodyFlag} '${url.toString()}'\n`,
      );
    }

    const data = await request<Record<string, unknown>>(
      {
        path: opts.path,
        method: method.toUpperCase() as "GET" | "POST",
        query,
        body,
        cacheTtlSec: cacheTtl(commandOpts),
        // We handled --explain ourselves so we can capture it in IOResult.stderr.
      },
      str(commandOpts, "api-key"),
    );

    const format = resolveFormat(commandOpts);
    let bodyText: string;
    if (format === "json") {
      bodyText = JSON.stringify(data, null, 2) + "\n";
    } else {
      const select = (query.select as string | undefined) ?? opts.defaultSelect;
      const columnsOut = select ? select.split(",") : undefined;
      if (opts.single) {
        const row = opts.rowsKey
          ? ((data[opts.rowsKey] as Record<string, unknown>) ?? data)
          : data;
        bodyText = renderSingle(row, { format }) + "\n";
      } else {
        const rows = opts.rowsKey
          ? ((data[opts.rowsKey] as Record<string, unknown>[]) ?? [])
          : Array.isArray(data)
            ? (data as unknown as Record<string, unknown>[])
            : (firstArray(data) ?? []);
        bodyText =
          render(rows, {
            format,
            columns: columnsOut,
            colorize: colorizeMetric,
          }) + "\n";
      }
    }

    return [
      ENC.encode(bodyText),
      new IOResult({ stderr: stderr.join("") }),
    ] as [Uint8Array, IOResult];
  };

  return command({
    name: opts.name,
    spec,
    fn,
    description,
    longHelp,
  });
}

function firstArray(
  obj: Record<string, unknown>,
): Record<string, unknown>[] | undefined {
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) return v as Record<string, unknown>[];
  }
  return undefined;
}

function autoSelect(columns: Column[]): string[] {
  const skipSuffix = /(_prev|_diff|_diff_percent|_merged|_history|_count)$/;
  const isIdentifierName =
    /^(keyword|url|domain|anchor|target|competitor_domain|raw_url|page|title|name|subject|host|ip|first_seen|last_seen|date|first_visited|last_visited)$/;
  const candidates = columns.filter(
    (c) =>
      !skipSuffix.test(c.name) &&
      !c.name.startsWith("is_") &&
      !c.name.startsWith("has_"),
  );
  const ids = candidates.filter((c) => isIdentifierName.test(c.name));
  const cheapMetrics = candidates.filter(
    (c) =>
      !ids.includes(c) &&
      !c.unitsCost &&
      ["integer", "number", "float", "string", "string?"].includes(c.type),
  );
  const picked: string[] = [];
  for (const c of ids) {
    if (picked.length >= 6) break;
    picked.push(c.name);
  }
  for (const c of cheapMetrics) {
    if (picked.length >= 6) break;
    picked.push(c.name);
  }
  return picked;
}

function buildLongHelp(
  opts: BuildOpts,
  columns: Column[],
  method: "get" | "post",
  params: import("./spec.ts").Parameter[],
): string {
  const lines: string[] = [];
  const base = describeEndpoint(method, opts.path);
  // Only include the long description portion (skip the leading summary line
  // since it's already shown by commander as the description).
  const longBase = base.split("\n\n").slice(1).join("\n\n");
  if (longBase) lines.push(longBase);

  const whereParam = params.find((p) => p.name === "where");
  if (whereParam?.description) {
    const matches = [
      ...whereParam.description.matchAll(/\*\*([a-z0-9_]+)\*\*\s*:/g),
    ];
    if (matches.length > 0) {
      const names = matches.map((m) => m[1]).slice(0, 40);
      if (lines.length) lines.push("");
      lines.push(`Filter columns (--where): ${names.join(", ")}`);
    }
  }

  if (columns.length > 0) {
    if (lines.length) lines.push("");
    lines.push(`Columns (--select): ${columns.length} available`);
    const cheap = columns.filter((c) => !c.unitsCost);
    const costly = columns.filter((c) => c.unitsCost);
    if (cheap.length > 0) {
      lines.push("  " + cheap.map((c) => c.name).join(", "));
    }
    if (costly.length > 0) {
      lines.push("  Costly (extra units):");
      for (const c of costly) {
        lines.push(
          `    ${c.name} (+${c.unitsCost}u): ${c.description.slice(0, 80)}`,
        );
      }
    }
  }

  const example = buildExample(opts, params);
  if (example) {
    if (lines.length) lines.push("");
    lines.push("Example:");
    lines.push("  " + example);
  }

  return lines.join("\n");
}

function buildExample(
  opts: BuildOpts,
  params: import("./spec.ts").Parameter[],
): string | null {
  const section = opts.path.split("/")[1] ?? "";
  const cmd =
    section === "subscription-info"
      ? `ahrefs account ${opts.name}`
      : section === "batch-analysis"
        ? `ahrefs batch-analysis`
        : `ahrefs ${section} ${opts.name}`;

  const parts: string[] = [cmd];
  if (opts.positional === "target") parts.push("ahrefs.com");
  else if (opts.positional === "keywords") parts.push('"vegan protein"');
  else if (opts.positional) parts.push(`<${opts.positional}>`);

  const hasCountry = params.some((p) => p.name === "country" && p.required);
  if (hasCountry) parts.push("--country us");

  return parts.join(" ");
}

function renderShortHelp(opts: BuildOpts, spec: CommandSpec): string {
  const lines: string[] = [];
  const section = opts.path.split("/")[1] ?? "";
  const cmd =
    section === "subscription-info"
      ? `ahrefs account ${opts.name}`
      : section === "batch-analysis"
        ? `ahrefs batch-analysis`
        : `ahrefs ${section} ${opts.name}`;
  if (spec.description) lines.push(spec.description);
  lines.push("");
  lines.push(
    `USAGE: ${cmd} [OPTIONS]${
      opts.positional ? ` [${opts.positional.toUpperCase()}]` : ""
    }`,
  );
  lines.push("");
  lines.push("FLAGS:");
  for (const opt of spec.options) {
    const o = opt as Option;
    const desc = (o.description ?? "").replace(/\s+/g, " ").slice(0, 80);
    const name = "--" + (o.long ?? o.short ?? "");
    lines.push(`  ${name.padEnd(22)} ${desc}`);
  }
  lines.push("");
  lines.push(
    `Run without --help-short for full docs (columns, filters, examples).`,
  );
  return lines.join("\n");
}
