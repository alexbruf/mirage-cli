/**
 * Turn a SQL-like WHERE expression into Windsor's JSON filter format.
 *
 *   spend > 100 and (campaign contains 'brand' or campaign like '%promo%')
 *   →  [["spend","gt",100],"and",[["campaign","contains","brand"],"or",["campaign","contains","promo"]]]
 *
 * Windsor filters are evaluated server-side, so this only narrows the rows
 * Windsor returns; it never runs code locally. `and` binds tighter than `or`.
 * Docs: https://windsor.ai/api-documentation/#data-filtering
 */

export type Value = string | number | boolean | null;
export type Condition = [field: string, op: string, value: Value];
export type FilterGroup = Array<Condition | FilterGroup | "and" | "or">;

type Node =
  | { kind: "cond"; cond: Condition }
  | { kind: "and" | "or"; items: Node[] };

type Token =
  | { t: "ident"; v: string }
  | { t: "str"; v: string }
  | { t: "num"; v: number }
  | { t: "op"; v: string }
  | { t: "lparen" }
  | { t: "rparen" };

const OPS: Record<string, string> = {
  "=": "eq",
  "==": "eq",
  "!=": "neq",
  "<>": "neq",
  ">": "gt",
  ">=": "gte",
  "<": "lt",
  "<=": "lte",
  "~": "contains",
  "!~": "ncontains",
};

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "(") {
      out.push({ t: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      out.push({ t: "rparen" });
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      // Quote is escaped by doubling it, SQL-style: 'it''s'.
      let s = "";
      i++;
      for (;;) {
        if (i >= src.length) throw new Error(`Unterminated string in --where: ${src}`);
        if (src[i] === ch) {
          if (src[i + 1] === ch) {
            s += ch;
            i += 2;
            continue;
          }
          i++;
          break;
        }
        s += src[i];
        i++;
      }
      out.push({ t: "str", v: s });
      continue;
    }
    const op = /^(==|!=|<>|>=|<=|!~|=|>|<|~)/.exec(src.slice(i));
    if (op) {
      out.push({ t: "op", v: op[1]! });
      i += op[1]!.length;
      continue;
    }
    const num = /^-?\d+(\.\d+)?(?![\w.])/.exec(src.slice(i));
    if (num) {
      out.push({ t: "num", v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][\w.\-]*/.exec(src.slice(i));
    if (id) {
      out.push({ t: "ident", v: id[0] });
      i += id[0].length;
      continue;
    }
    throw new Error(`Unexpected character "${ch}" in --where: ${src}`);
  }
  return out;
}

class Parser {
  private pos = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly src: string,
  ) {}

  parse(): Node {
    const node = this.or();
    if (this.pos < this.tokens.length) this.fail("unexpected trailing input");
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private kw(word: string): boolean {
    const tok = this.peek();
    return tok?.t === "ident" && tok.v.toLowerCase() === word;
  }

  private fail(msg: string): never {
    throw new Error(`Invalid --where (${msg}): ${this.src}`);
  }

  private or(): Node {
    const items = [this.and()];
    while (this.kw("or")) {
      this.pos++;
      items.push(this.and());
    }
    return items.length === 1 ? items[0]! : { kind: "or", items };
  }

  private and(): Node {
    const items = [this.atom()];
    while (this.kw("and")) {
      this.pos++;
      items.push(this.atom());
    }
    return items.length === 1 ? items[0]! : { kind: "and", items };
  }

  private atom(): Node {
    const tok = this.peek();
    if (tok?.t === "lparen") {
      this.pos++;
      const inner = this.or();
      if (this.peek()?.t !== "rparen") this.fail("missing )");
      this.pos++;
      return inner;
    }
    return { kind: "cond", cond: this.condition() };
  }

  private condition(): Condition {
    const fieldTok = this.peek();
    if (fieldTok?.t !== "ident") this.fail("expected a field name");
    const field = fieldTok.v;
    this.pos++;

    if (this.kw("is")) {
      this.pos++;
      let negate = false;
      if (this.kw("not")) {
        negate = true;
        this.pos++;
      }
      if (!this.kw("null")) this.fail(`expected NULL after "${field} is"`);
      this.pos++;
      return [field, negate ? "notnull" : "null", null];
    }

    let negate = false;
    if (this.kw("not")) {
      negate = true;
      this.pos++;
    }
    if (this.kw("contains")) {
      this.pos++;
      return [field, negate ? "ncontains" : "contains", String(this.value())];
    }
    if (this.kw("like")) {
      this.pos++;
      return [field, negate ? "ncontains" : "contains", likeToContains(String(this.value()), this.src)];
    }
    if (negate) this.fail(`expected CONTAINS or LIKE after "${field} not"`);

    const opTok = this.peek();
    if (opTok?.t !== "op") this.fail(`expected an operator after "${field}"`);
    this.pos++;
    return [field, OPS[opTok.v]!, this.value()];
  }

  private value(): Value {
    const tok = this.peek();
    if (!tok) this.fail("expected a value");
    this.pos++;
    if (tok.t === "str" || tok.t === "num") return tok.v;
    if (tok.t === "ident") {
      const lower = tok.v.toLowerCase();
      if (lower === "null") return null;
      if (lower === "true") return true;
      if (lower === "false") return false;
      // Bare words are strings, so `country = US` works without quotes.
      return tok.v;
    }
    this.fail("expected a value");
  }
}

/** Windsor only has substring matching, so LIKE accepts only '%x%', 'x%', '%x', or 'x'. */
function likeToContains(pattern: string, src: string): string {
  const inner = pattern.replace(/^%/, "").replace(/%$/, "");
  if (inner.includes("%") || inner.includes("_")) {
    throw new Error(
      `Invalid --where: LIKE only supports a single substring ('%text%'); got '${pattern}' in: ${src}`,
    );
  }
  return inner;
}

function toItem(node: Node): Condition | FilterGroup {
  return node.kind === "cond" ? node.cond : toGroup(node);
}

function toGroup(node: Node): FilterGroup {
  if (node.kind === "cond") return [node.cond];
  const out: FilterGroup = [];
  node.items.forEach((item, i) => {
    if (i > 0) out.push(node.kind as "and" | "or");
    out.push(toItem(item));
  });
  return out;
}

/** Parse one or more WHERE expressions (ANDed together) into a Windsor filter. */
export function parseWhere(exprs: string[]): FilterGroup {
  const nodes = exprs.map((e) => new Parser(tokenize(e), e).parse());
  if (nodes.length === 0) throw new Error("parseWhere needs at least one expression");
  return toGroup(nodes.length === 1 ? nodes[0]! : { kind: "and", items: nodes });
}
