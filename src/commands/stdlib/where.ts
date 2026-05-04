function parsePredicate(expr) {
  const m = expr.match(/^([a-zA-Z0-9_.]+)\s*(==|=|!=|<=|>=|<|>)\s*(.+)$/);
  if (!m) throw new Error(`Invalid where expression: ${expr}`);
  const [, path, op, rawValue] = m;

  let value = rawValue;
  if (rawValue === 'true') value = true;
  else if (rawValue === 'false') value = false;
  else if (rawValue === 'null') value = null;
  else if (!Number.isNaN(Number(rawValue)) && rawValue.trim() !== '') value = Number(rawValue);

  return { path, op: op === '=' ? '==' : op, value };
}

function getPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

function compare(left, op, right) {
  switch (op) {
    case '==': return left == right; // intentional loose equality for convenience
    case '!=': return left != right;
    case '<': return left < right;
    case '<=': return left <= right;
    case '>': return left > right;
    case '>=': return left >= right;
    default: throw new Error(`Unsupported operator: ${op}`);
  }
}

function parseCompound(expr) {
  // Split on || first (lower precedence), then && within each branch
  const orBranches = expr.split('||').map((s) => s.trim());
  return orBranches.map((branch) => {
    const andParts = branch.split('&&').map((s) => s.trim()).filter(Boolean);
    return andParts.map(parsePredicate);
  });
}

function evalCompound(item, branches) {
  // OR of ANDs: at least one branch must have all predicates true
  return branches.some((andPreds) =>
    andPreds.every((pred) => compare(getPath(item, pred.path), pred.op, pred.value))
  );
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
      `  ... | where "status=active || priority>3"\n\n` +
      `Notes:\n` +
      `  - && (AND) and || (OR) combine multiple predicates.\n` +
      `  - && binds tighter than ||.\n` +
      `  - Quote the expression when using && or ||.\n`
    );
  },
  async run({ input, args }) {
    const expr = args._.join(' ');
    if (!expr) throw new Error('where requires an expression (e.g. field=value)');

    const branches = parseCompound(expr);

    return {
      output: (async function* () {
        for await (const item of input) {
          if (evalCompound(item, branches)) yield item;
        }
      })(),
    };
  },
};
