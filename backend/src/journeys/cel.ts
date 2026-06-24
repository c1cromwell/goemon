/**
 * CEL (cel.dev) compatible-subset evaluator for journey conditions/branching.
 *
 * Self-contained port of fraud-engine/src/rules/celEvaluator.ts (the two services
 * stay decoupled, so a copy is correct — not a shared import). Same non-Turing-
 * complete subset: field access, `== != < <= > >= + - * / %`, `&& || !`, `in`,
 * ternary, `size()`/`has()` — no loops/comprehensions/user-functions, so a journey
 * condition cannot loop, crash, or reach outside its activation. A bad expression
 * throws at compile, never mid-run. cel-go is the spec-complete production swap.
 */

type Node =
  | { t: "lit"; v: CelValue }
  | { t: "id"; name: string }
  | { t: "field"; obj: Node; name: string }
  | { t: "unary"; op: "!" | "-"; e: Node }
  | { t: "bin"; op: BinOp; l: Node; r: Node }
  | { t: "and"; l: Node; r: Node }
  | { t: "or"; l: Node; r: Node }
  | { t: "ternary"; c: Node; a: Node; b: Node }
  | { t: "call"; name: string; args: Node[] };

type BinOp = "*" | "/" | "%" | "+" | "-" | "<" | "<=" | ">" | ">=" | "==" | "!=" | "in";

export type CelValue = number | boolean | string | null | CelValue[] | { [k: string]: CelValue };
export type Activation = Record<string, CelValue>;

export interface CompiledExpr {
  readonly source: string;
  readonly ast: Node;
}

export class CelError extends Error {}

// ---- tokenizer --------------------------------------------------------------
type Tok = { k: "num"; v: number } | { k: "str"; v: string } | { k: "id"; v: string } | { k: "op"; v: string } | { k: "eof" };
const KEYWORDS: Record<string, CelValue> = { true: true, false: false, null: null };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const isIdStart = (c: string) => /[A-Za-z_]/.test(c);
  const isId = (c: string) => /[A-Za-z0-9_]/.test(c);
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (isIdStart(c)) { let j = i + 1; while (j < src.length && isId(src[j]!)) j++; toks.push({ k: "id", v: src.slice(i, j) }); i = j; continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i + 1; while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      const num = Number(src.slice(i, j));
      if (!Number.isFinite(num)) throw new CelError(`bad number near ${src.slice(i, j)}`);
      toks.push({ k: "num", v: num }); i = j; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1; let out = "";
      while (j < src.length && src[j] !== c) { if (src[j] === "\\" && j + 1 < src.length) { out += src[j + 1]; j += 2; } else { out += src[j]; j++; } }
      if (j >= src.length) throw new CelError("unterminated string");
      toks.push({ k: "str", v: out }); i = j + 1; continue;
    }
    const two = src.slice(i, i + 2);
    if (["&&", "||", "==", "!=", "<=", ">="].includes(two)) { toks.push({ k: "op", v: two }); i += 2; continue; }
    if ("!-+*/%<>().,?:".includes(c)) { toks.push({ k: "op", v: c }); i++; continue; }
    throw new CelError(`unexpected character '${c}'`);
  }
  toks.push({ k: "eof" });
  return toks;
}

// ---- Pratt parser -----------------------------------------------------------
class Parser {
  private p = 0;
  constructor(private toks: Tok[]) {}
  private peek(): Tok { return this.toks[this.p]!; }
  private next(): Tok { return this.toks[this.p++]!; }
  private eat(op: string): void { const t = this.next(); if (t.k !== "op" || t.v !== op) throw new CelError(`expected '${op}'`); }
  private isOp(v: string): boolean { const t = this.peek(); return t.k === "op" && t.v === v; }
  parse(): Node { const n = this.ternary(); if (this.peek().k !== "eof") throw new CelError("trailing tokens"); return n; }
  private ternary(): Node { const c = this.or(); if (this.isOp("?")) { this.next(); const a = this.or(); this.eat(":"); const b = this.ternary(); return { t: "ternary", c, a, b }; } return c; }
  private or(): Node { let l = this.and(); while (this.isOp("||")) { this.next(); l = { t: "or", l, r: this.and() }; } return l; }
  private and(): Node { let l = this.eq(); while (this.isOp("&&")) { this.next(); l = { t: "and", l, r: this.eq() }; } return l; }
  private eq(): Node { let l = this.rel(); while (this.isOp("==") || this.isOp("!=")) { const op = (this.next() as { v: string }).v as BinOp; l = { t: "bin", op, l, r: this.rel() }; } return l; }
  private rel(): Node {
    let l = this.add();
    while (this.isOp("<") || this.isOp("<=") || this.isOp(">") || this.isOp(">=") || (this.peek().k === "id" && (this.peek() as { v: string }).v === "in")) {
      const t = this.next(); const op = (t.k === "id" ? "in" : (t as { v: string }).v) as BinOp; l = { t: "bin", op, l, r: this.add() };
    }
    return l;
  }
  private add(): Node { let l = this.mul(); while (this.isOp("+") || this.isOp("-")) { const op = (this.next() as { v: string }).v as BinOp; l = { t: "bin", op, l, r: this.mul() }; } return l; }
  private mul(): Node { let l = this.unary(); while (this.isOp("*") || this.isOp("/") || this.isOp("%")) { const op = (this.next() as { v: string }).v as BinOp; l = { t: "bin", op, l, r: this.unary() }; } return l; }
  private unary(): Node {
    if (this.isOp("!")) { this.next(); return { t: "unary", op: "!", e: this.unary() }; }
    if (this.isOp("-")) { this.next(); return { t: "unary", op: "-", e: this.unary() }; }
    return this.postfix();
  }
  private postfix(): Node {
    let n = this.primary();
    for (;;) {
      if (this.isOp(".")) { this.next(); const id = this.next(); if (id.k !== "id") throw new CelError("expected field name after '.'"); n = { t: "field", obj: n, name: id.v }; }
      else break;
    }
    return n;
  }
  private primary(): Node {
    const t = this.next();
    if (t.k === "num") return { t: "lit", v: t.v };
    if (t.k === "str") return { t: "lit", v: t.v };
    if (t.k === "op" && t.v === "(") { const n = this.ternary(); this.eat(")"); return n; }
    if (t.k === "id") {
      if (t.v in KEYWORDS) return { t: "lit", v: KEYWORDS[t.v]! };
      if (this.isOp("(")) { this.next(); const args: Node[] = []; if (!this.isOp(")")) { args.push(this.ternary()); while (this.isOp(",")) { this.next(); args.push(this.ternary()); } } this.eat(")"); return { t: "call", name: t.v, args }; }
      return { t: "id", name: t.v };
    }
    throw new CelError("unexpected token");
  }
}

// ---- evaluator --------------------------------------------------------------
function truthy(v: CelValue): boolean { return v === true; }

function evalNode(n: Node, act: Activation): CelValue {
  switch (n.t) {
    case "lit": return n.v;
    case "id": return n.name in act ? act[n.name]! : null; // missing var → null (forgiving for journey context)
    case "field": { const o = evalNode(n.obj, act); if (o && typeof o === "object" && !Array.isArray(o)) return (o as Record<string, CelValue>)[n.name] ?? null; return null; }
    case "unary": { const e = evalNode(n.e, act); if (n.op === "!") return !truthy(e); if (typeof e !== "number") throw new CelError("unary '-' needs a number"); return -e; }
    case "and": return truthy(evalNode(n.l, act)) ? truthy(evalNode(n.r, act)) : false;
    case "or": return truthy(evalNode(n.l, act)) ? true : truthy(evalNode(n.r, act));
    case "ternary": return truthy(evalNode(n.c, act)) ? evalNode(n.a, act) : evalNode(n.b, act);
    case "call": {
      if (n.name === "size") { const a = evalNode(n.args[0]!, act); if (typeof a === "string" || Array.isArray(a)) return a.length; throw new CelError("size() needs a string or list"); }
      if (n.name === "has") { const a = n.args[0]!; return a.t === "id" ? a.name in act : a.t === "field"; }
      throw new CelError(`unknown function '${n.name}'`);
    }
    case "bin": return evalBin(n.op, evalNode(n.l, act), evalNode(n.r, act));
  }
}

function evalBin(op: BinOp, l: CelValue, r: CelValue): CelValue {
  switch (op) {
    case "in": if (Array.isArray(r)) return r.some((x) => x === l); if (r && typeof r === "object") return l != null && String(l) in r; throw new CelError("'in' needs a list or map");
    case "==": return l === r;
    case "!=": return l !== r;
  }
  if (typeof l === "number" && typeof r === "number") {
    switch (op) {
      case "*": return l * r;
      case "/": if (r === 0) throw new CelError("division by zero"); return Math.trunc(l / r);
      case "%": if (r === 0) throw new CelError("modulo by zero"); return l % r;
      case "+": return l + r;
      case "-": return l - r;
      case "<": return l < r;
      case "<=": return l <= r;
      case ">": return l > r;
      case ">=": return l >= r;
    }
  }
  if (op === "+" && typeof l === "string" && typeof r === "string") return l + r;
  if ((op === "<" || op === "<=" || op === ">" || op === ">=") && typeof l === "string" && typeof r === "string") {
    return op === "<" ? l < r : op === "<=" ? l <= r : op === ">" ? l > r : l >= r;
  }
  throw new CelError(`operator '${op}' not valid for these operand types`);
}

// ---- public API -------------------------------------------------------------
export function compile(source: string): CompiledExpr {
  try { return { source, ast: new Parser(tokenize(source)).parse() }; }
  catch (e) { throw new CelError(`compile error in "${source}": ${(e as Error).message}`); }
}

export function evaluate(expr: CompiledExpr, activation: Activation): CelValue {
  return evalNode(expr.ast, activation);
}

/** Compile (if needed) + evaluate to a boolean — the journey-condition entrypoint. */
export function test(expr: CompiledExpr | string, activation: Activation): boolean {
  const c = typeof expr === "string" ? compile(expr) : expr;
  return truthy(evalNode(c.ast, activation));
}
