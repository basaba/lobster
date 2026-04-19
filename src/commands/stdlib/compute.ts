import { parseExpr, evaluate } from '../../core/expr.js';

function parseAssignments(tokens: string[]): Array<{ key: string; expr: string }> {
  const out: Array<{ key: string; expr: string }> = [];
  for (const tok of tokens ?? []) {
    const s = String(tok);
    const idx = s.indexOf('=');
    if (idx === -1) continue;
    const key = s.slice(0, idx).trim();
    const expr = s.slice(idx + 1);
    if (!key) continue;
    out.push({ key, expr });
  }
  return out;
}

export const computeCommand = {
  name: 'compute',
  meta: {
    description: 'Add computed properties to items using expressions',
    argsSchema: {
      type: 'object',
      properties: {
        _: {
          type: 'array',
          items: { type: 'string' },
          description: 'Assignments like field=expression',
        },
      },
      required: ['_'],
    },
    sideEffects: [],
  },
  help() {
    return (
      `compute — add computed properties to items using expressions\n\n` +
      `Usage:\n` +
      `  ... | compute unreviewed='every(reviewers, @.vote == 0)'\n` +
      `  ... | compute age='days_since(createdAt)' recent='days_since(createdAt) < 30'\n` +
      `  ... | compute full_name='concat(first, " ", last)'\n\n` +
      `Expressions:\n` +
      `  Property access: foo.bar, $.foo, @.field (array element)\n` +
      `  Literals: 42, "text", true, false, null\n` +
      `  Operators: + - * / % == != < <= > >= && || !\n` +
      `  Functions: length, every, some, count, concat, lower, upper,\n` +
      `             trim, contains, starts_with, ends_with, now,\n` +
      `             days_since, hours_since, coalesce, is_null, exists\n`
    );
  },
  async run({ input, args }: any) {
    const raw = Array.isArray(args._) ? args._ : [];
    if (raw.length === 0) throw new Error('compute requires at least one assignment (e.g. field=expression)');

    const assignments = parseAssignments(raw);
    if (assignments.length === 0) throw new Error('compute requires key=expression assignments');

    // Parse all expressions once up front
    const compiled = assignments.map(({ key, expr }) => ({
      key,
      ast: parseExpr(expr),
    }));

    return {
      output: (async function* () {
        for await (const item of input) {
          let cur: any = item;
          if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) {
            cur = { value: cur };
          } else {
            cur = { ...cur };
          }

          for (const { key, ast } of compiled) {
            cur[key] = evaluate(ast, item);
          }

          yield cur;
        }
      })(),
    };
  },
};
