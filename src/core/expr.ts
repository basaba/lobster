// Expression engine for the compute command.
// Supports: literals, property paths ($, @), comparison, logic, arithmetic,
// function calls (length, every, some, count, concat, lower, upper, contains,
// starts_with, ends_with, now, days_since, hours_since, coalesce, is_null).

// ---- Token types ----

type TokenType =
  | 'number' | 'string' | 'ident' | 'bool' | 'null'
  | '(' | ')' | ',' | '.'
  | '+' | '-' | '*' | '/' | '%'
  | '==' | '!=' | '<' | '<=' | '>' | '>='
  | '&&' | '||' | '!' | 'eof';

interface Token {
  type: TokenType;
  value: string | number | boolean | null;
  pos: number;
}

// ---- AST node types ----

export type ASTNode =
  | { kind: 'literal'; value: unknown }
  | { kind: 'path'; root: '$' | '@'; parts: string[] }
  | { kind: 'binary'; op: string; left: ASTNode; right: ASTNode }
  | { kind: 'unary'; op: string; operand: ASTNode }
  | { kind: 'call'; name: string; args: ASTNode[] };

// ---- Tokenizer ----

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < src.length) {
    // skip whitespace
    if (src[i] === ' ' || src[i] === '\t' || src[i] === '\n' || src[i] === '\r') { i++; continue; }

    const pos = i;

    // two-char operators
    const two = src.slice(i, i + 2);
    if (two === '==' || two === '!=' || two === '<=' || two === '>=' || two === '&&' || two === '||') {
      tokens.push({ type: two as TokenType, value: two, pos });
      i += 2;
      continue;
    }

    // single-char tokens
    const ch = src[i];
    if ('(),.+-*/%'.includes(ch)) {
      tokens.push({ type: ch as TokenType, value: ch, pos });
      i++;
      continue;
    }
    if (ch === '<' || ch === '>' || ch === '!') {
      tokens.push({ type: ch as TokenType, value: ch, pos });
      i++;
      continue;
    }

    // number literal
    if (ch >= '0' && ch <= '9') {
      let num = '';
      while (i < src.length && ((src[i] >= '0' && src[i] <= '9') || src[i] === '.')) {
        num += src[i];
        i++;
      }
      tokens.push({ type: 'number', value: Number(num), pos });
      continue;
    }

    // string literal
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let s = '';
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < src.length) {
          s += src[i + 1];
          i += 2;
        } else {
          s += src[i];
          i++;
        }
      }
      if (i < src.length) i++; // skip closing quote
      tokens.push({ type: 'string', value: s, pos });
      continue;
    }

    // identifier (or $ / @ prefix)
    if (ch === '$' || ch === '@' || (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      let id = '';
      while (i < src.length && ((src[i] >= 'a' && src[i] <= 'z') || (src[i] >= 'A' && src[i] <= 'Z') ||
             (src[i] >= '0' && src[i] <= '9') || src[i] === '_' || src[i] === '$' || src[i] === '@')) {
        id += src[i];
        i++;
      }
      if (id === 'true') tokens.push({ type: 'bool', value: true, pos });
      else if (id === 'false') tokens.push({ type: 'bool', value: false, pos });
      else if (id === 'null') tokens.push({ type: 'null', value: null, pos });
      else tokens.push({ type: 'ident', value: id, pos });
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at position ${pos}`);
  }

  tokens.push({ type: 'eof', value: null, pos: i });
  return tokens;
}

// ---- Parser (recursive descent) ----

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token { return this.tokens[this.pos]; }
  private advance(): Token { return this.tokens[this.pos++]; }

  private expect(type: TokenType): Token {
    const t = this.advance();
    if (t.type !== type) throw new Error(`Expected ${type} but got ${t.type} at position ${t.pos}`);
    return t;
  }

  parse(): ASTNode {
    const node = this.parseOr();
    if (this.peek().type !== 'eof') {
      throw new Error(`Unexpected token '${this.peek().value}' at position ${this.peek().pos}`);
    }
    return node;
  }

  private parseOr(): ASTNode {
    let left = this.parseAnd();
    while (this.peek().type === '||') {
      this.advance();
      const right = this.parseAnd();
      left = { kind: 'binary', op: '||', left, right };
    }
    return left;
  }

  private parseAnd(): ASTNode {
    let left = this.parseComparison();
    while (this.peek().type === '&&') {
      this.advance();
      const right = this.parseComparison();
      left = { kind: 'binary', op: '&&', left, right };
    }
    return left;
  }

  private parseComparison(): ASTNode {
    let left = this.parseAddSub();
    const t = this.peek().type;
    if (t === '==' || t === '!=' || t === '<' || t === '<=' || t === '>' || t === '>=') {
      const op = this.advance().value as string;
      const right = this.parseAddSub();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseAddSub(): ASTNode {
    let left = this.parseMulDiv();
    while (this.peek().type === '+' || this.peek().type === '-') {
      const op = this.advance().value as string;
      const right = this.parseMulDiv();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseMulDiv(): ASTNode {
    let left = this.parseUnary();
    while (this.peek().type === '*' || this.peek().type === '/' || this.peek().type === '%') {
      const op = this.advance().value as string;
      const right = this.parseUnary();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseUnary(): ASTNode {
    if (this.peek().type === '!') {
      this.advance();
      const operand = this.parseUnary();
      return { kind: 'unary', op: '!', operand };
    }
    if (this.peek().type === '-' && this.isUnaryMinus()) {
      this.advance();
      const operand = this.parseUnary();
      return { kind: 'unary', op: '-', operand };
    }
    return this.parsePostfix();
  }

  private isUnaryMinus(): boolean {
    // After an operator or at start of expression, '-' is unary
    if (this.pos === 0) return true;
    const prev = this.tokens[this.pos - 1].type;
    return prev === '(' || prev === ',' || prev === '==' || prev === '!='
        || prev === '<' || prev === '<=' || prev === '>' || prev === '>='
        || prev === '&&' || prev === '||' || prev === '+' || prev === '-'
        || prev === '*' || prev === '/' || prev === '%' || prev === '!';
  }

  private parsePostfix(): ASTNode {
    let node = this.parsePrimary();
    // dot access chains: expr.field.field
    while (this.peek().type === '.') {
      this.advance();
      const ident = this.expect('ident');
      if (node.kind === 'path') {
        node.parts.push(ident.value as string);
      } else {
        // Can't dot-access on non-path node at parse time; wrap it
        node = { kind: 'call', name: '__dot', args: [node, { kind: 'literal', value: ident.value }] };
      }
    }
    return node;
  }

  private parsePrimary(): ASTNode {
    const t = this.peek();

    // parenthesized expression
    if (t.type === '(') {
      this.advance();
      const inner = this.parseOr();
      this.expect(')');
      return inner;
    }

    // literals
    if (t.type === 'number' || t.type === 'string' || t.type === 'bool' || t.type === 'null') {
      this.advance();
      return { kind: 'literal', value: t.value };
    }

    // identifier: could be path, function call, or keyword
    if (t.type === 'ident') {
      const name = t.value as string;
      this.advance();

      // function call
      if (this.peek().type === '(') {
        this.advance();
        const args: ASTNode[] = [];
        if (this.peek().type !== ')') {
          args.push(this.parseOr());
          while (this.peek().type === ',') {
            this.advance();
            args.push(this.parseOr());
          }
        }
        this.expect(')');
        return { kind: 'call', name, args };
      }

      // path: could start with $ or @ or be a bare identifier
      if (name === '$' || name === '@') {
        const parts: string[] = [];
        while (this.peek().type === '.') {
          this.advance();
          const part = this.expect('ident');
          parts.push(part.value as string);
        }
        return { kind: 'path', root: name as '$' | '@', parts };
      }

      // bare identifier = implicit $ path
      return { kind: 'path', root: '$', parts: [name] };
    }

    throw new Error(`Unexpected token '${t.value}' at position ${t.pos}`);
  }
}

// ---- Public parse function ----

export function parseExpr(src: string): ASTNode {
  const tokens = tokenize(src);
  const parser = new Parser(tokens);
  return parser.parse();
}

// ---- Evaluator ----

function getByPath(obj: unknown, parts: string[]): unknown {
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as any)[p];
  }
  return cur;
}

type EvalContext = { root: unknown; element: unknown };

const BUILTIN_FUNCTIONS: Record<string, (args: ASTNode[], ctx: EvalContext) => unknown> = {
  length(args, ctx) {
    if (args.length !== 1) throw new Error('length() requires exactly 1 argument');
    const val = evalNode(args[0], ctx);
    if (Array.isArray(val)) return val.length;
    if (typeof val === 'string') return val.length;
    return 0;
  },

  every(args, ctx) {
    if (args.length !== 2) throw new Error('every() requires 2 arguments: array and predicate');
    const arr = evalNode(args[0], ctx);
    if (!Array.isArray(arr)) return false;
    for (const el of arr) {
      const result = evalNode(args[1], { root: ctx.root, element: el });
      if (!result) return false;
    }
    return true; // every([]) = true
  },

  some(args, ctx) {
    if (args.length !== 2) throw new Error('some() requires 2 arguments: array and predicate');
    const arr = evalNode(args[0], ctx);
    if (!Array.isArray(arr)) return false;
    for (const el of arr) {
      const result = evalNode(args[1], { root: ctx.root, element: el });
      if (result) return true;
    }
    return false; // some([]) = false
  },

  count(args, ctx) {
    if (args.length !== 2) throw new Error('count() requires 2 arguments: array and predicate');
    const arr = evalNode(args[0], ctx);
    if (!Array.isArray(arr)) return 0;
    let n = 0;
    for (const el of arr) {
      if (evalNode(args[1], { root: ctx.root, element: el })) n++;
    }
    return n;
  },

  concat(args, ctx) {
    return args.map(a => String(evalNode(a, ctx) ?? '')).join('');
  },

  lower(args, ctx) {
    if (args.length !== 1) throw new Error('lower() requires exactly 1 argument');
    return String(evalNode(args[0], ctx) ?? '').toLowerCase();
  },

  upper(args, ctx) {
    if (args.length !== 1) throw new Error('upper() requires exactly 1 argument');
    return String(evalNode(args[0], ctx) ?? '').toUpperCase();
  },

  trim(args, ctx) {
    if (args.length !== 1) throw new Error('trim() requires exactly 1 argument');
    return String(evalNode(args[0], ctx) ?? '').trim();
  },

  contains(args, ctx) {
    if (args.length !== 2) throw new Error('contains() requires 2 arguments');
    const s = evalNode(args[0], ctx);
    const sub = evalNode(args[1], ctx);
    if (typeof s === 'string' && typeof sub === 'string') return s.includes(sub);
    if (Array.isArray(s)) return s.includes(sub);
    return false;
  },

  starts_with(args, ctx) {
    if (args.length !== 2) throw new Error('starts_with() requires 2 arguments');
    const s = String(evalNode(args[0], ctx) ?? '');
    const pre = String(evalNode(args[1], ctx) ?? '');
    return s.startsWith(pre);
  },

  ends_with(args, ctx) {
    if (args.length !== 2) throw new Error('ends_with() requires 2 arguments');
    const s = String(evalNode(args[0], ctx) ?? '');
    const suf = String(evalNode(args[1], ctx) ?? '');
    return s.endsWith(suf);
  },

  now(_args, _ctx) {
    return new Date().toISOString();
  },

  days_since(args, ctx) {
    if (args.length !== 1) throw new Error('days_since() requires exactly 1 argument');
    const val = evalNode(args[0], ctx);
    const d = new Date(val as string | number);
    if (Number.isNaN(d.getTime())) return null;
    return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
  },

  hours_since(args, ctx) {
    if (args.length !== 1) throw new Error('hours_since() requires exactly 1 argument');
    const val = evalNode(args[0], ctx);
    const d = new Date(val as string | number);
    if (Number.isNaN(d.getTime())) return null;
    return (Date.now() - d.getTime()) / (1000 * 60 * 60);
  },

  coalesce(args, ctx) {
    for (const a of args) {
      const v = evalNode(a, ctx);
      if (v != null) return v;
    }
    return null;
  },

  is_null(args, ctx) {
    if (args.length !== 1) throw new Error('is_null() requires exactly 1 argument');
    return evalNode(args[0], ctx) == null;
  },

  exists(args, ctx) {
    if (args.length !== 1) throw new Error('exists() requires exactly 1 argument');
    return evalNode(args[0], ctx) !== undefined;
  },
};

export function evalNode(node: ASTNode, ctx: EvalContext): unknown {
  switch (node.kind) {
    case 'literal':
      return node.value;

    case 'path': {
      const base = node.root === '@' ? ctx.element : ctx.root;
      return node.parts.length === 0 ? base : getByPath(base, node.parts);
    }

    case 'unary': {
      const v = evalNode(node.operand, ctx);
      if (node.op === '!') return !v;
      if (node.op === '-') return -(v as number);
      throw new Error(`Unknown unary op: ${node.op}`);
    }

    case 'binary': {
      // short-circuit for logic ops
      if (node.op === '&&') return evalNode(node.left, ctx) && evalNode(node.right, ctx);
      if (node.op === '||') return evalNode(node.left, ctx) || evalNode(node.right, ctx);

      const l = evalNode(node.left, ctx);
      const r = evalNode(node.right, ctx);

      switch (node.op) {
        case '+':  return (l as number) + (r as number);
        case '-':  return (l as number) - (r as number);
        case '*':  return (l as number) * (r as number);
        case '/':  return (l as number) / (r as number);
        case '%':  return (l as number) % (r as number);
        case '==': return l == r; // intentional loose equality matching where.ts
        case '!=': return l != r;
        case '<':  return (l as number) < (r as number);
        case '<=': return (l as number) <= (r as number);
        case '>':  return (l as number) > (r as number);
        case '>=': return (l as number) >= (r as number);
        default: throw new Error(`Unknown binary op: ${node.op}`);
      }
    }

    case 'call': {
      if (node.name === '__dot') {
        const obj = evalNode(node.args[0], ctx);
        const key = evalNode(node.args[1], ctx) as string;
        if (obj == null || typeof obj !== 'object') return undefined;
        return (obj as any)[key];
      }

      const fn = BUILTIN_FUNCTIONS[node.name];
      if (!fn) throw new Error(`Unknown function: ${node.name}`);
      return fn(node.args, ctx);
    }
  }
}

// ---- Public evaluate function ----

export function evaluate(ast: ASTNode, item: unknown): unknown {
  return evalNode(ast, { root: item, element: item });
}
