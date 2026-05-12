import { parseExpr, evaluate, type ASTNode } from '../../core/expr.js';

/**
 * Backward-compatibility transform for `where` expressions.
 *
 * The old `where` parser treated the RHS of comparisons as string literals
 * by default (e.g. `status==queued` compared against the string "queued").
 * The full expression parser treats `queued` as a property path `$.queued`.
 *
 * This transform walks the AST and converts bare identifier paths on the RHS
 * of comparison operators into string literals, unless they are:
 * - Explicitly rooted with `$` or `@`
 * - Boolean/null literals (already handled by the parser)
 * - Function calls
 * - Numeric literals
 * - Already string literals
 */
function coerceBarePaths(node: ASTNode): ASTNode {
  if (node.kind === 'binary') {
    const isComparison = ['==', '!=', '<', '<=', '>', '>='].includes(node.op);
    const left = coerceBarePaths(node.left);
    let right = coerceBarePaths(node.right);

    if (isComparison && right.kind === 'path' && right.implicit && right.parts.length > 0) {
      // Bare path like `queued` or `foo.bar` on RHS → treat as string literal
      const str = right.parts.join('.');
      right = { kind: 'literal', value: str };
    }

    return { ...node, left, right };
  }

  if (node.kind === 'unary') {
    return { ...node, operand: coerceBarePaths(node.operand) };
  }

  if (node.kind === 'call') {
    return { ...node, args: node.args.map(coerceBarePaths) };
  }

  return node;
}

/**
 * Normalize single `=` to `==` in a quote-aware manner.
 * Skips `!=`, `<=`, `>=`, and `==`, and does not touch `=` inside quoted strings.
 */
function normalizeSingleEquals(expr: string): string {
  const result: string[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    // Skip quoted strings
    if (ch === '"' || ch === "'") {
      const quote = ch;
      result.push(ch);
      i++;
      while (i < expr.length && expr[i] !== quote) {
        if (expr[i] === '\\' && i + 1 < expr.length) {
          result.push(expr[i], expr[i + 1]);
          i += 2;
        } else {
          result.push(expr[i]);
          i++;
        }
      }
      if (i < expr.length) { result.push(expr[i]); i++; }
      continue;
    }

    // Check for multi-char operators containing '='
    if ((ch === '!' || ch === '<' || ch === '>') && i + 1 < expr.length && expr[i + 1] === '=') {
      result.push(ch, '=');
      i += 2;
      continue;
    }

    // Check for '==' (already double)
    if (ch === '=' && i + 1 < expr.length && expr[i + 1] === '=') {
      result.push('==');
      i += 2;
      continue;
    }

    // Single '=' → normalize to '=='
    if (ch === '=') {
      result.push('==');
      i++;
      continue;
    }

    result.push(ch);
    i++;
  }

  return result.join('');
}

export const whereCommand = {
  name: 'where',
  meta: {
    description: 'Filter objects by a predicate',
    argsSchema: {
      type: 'object',
      properties: {
        _: {
          type: 'array',
          items: { type: 'string' },
          description: 'First positional arg is an expression like field=value or minutes>=30',
        },
      },
      required: ['_'],
    },
    sideEffects: [],
  },
  help() {
    return (
      `where — filter objects by a predicate\n\n` +
      `Usage:\n` +
      `  ... | where unread=true\n` +
      `  ... | where minutes>=30\n` +
      `  ... | where sender.domain==example.com\n` +
      `  ... | where "x>5 && y<6"\n` +
      `  ... | where "status==active || priority>3"\n` +
      `  ... | where "(status==active || status==new) && priority>3"\n\n` +
      `Notes:\n` +
      `  - && (AND) and || (OR) combine multiple predicates.\n` +
      `  - && binds tighter than ||.\n` +
      `  - Use parentheses to group sub-expressions.\n` +
      `  - Quote the expression when using &&, ||, or parentheses.\n` +
      `  - Supports functions: contains(), starts_with(), length(), etc.\n` +
      `  - Bare identifiers on the RHS of comparisons are treated as strings.\n` +
      `    Use $.field to compare against another property.\n`
    );
  },
  async run({ input, args }) {
    const expr = args._.join(' ');
    if (!expr) throw new Error('where requires an expression (e.g. field=value)');

    const normalized = normalizeSingleEquals(expr);
    const rawAst = parseExpr(normalized);
    const ast = coerceBarePaths(rawAst);

    return {
      output: (async function* () {
        for await (const item of input) {
          if (evaluate(ast, item)) yield item;
        }
      })(),
    };
  },
};
