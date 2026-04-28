import { parseExpr, evaluate } from '../../core/expr.js';

export const gateCommand = {
  name: 'gate',
  meta: {
    description: 'Conditionally halt the pipeline based on a condition evaluated against input items',
    argsSchema: {
      type: 'object',
      properties: {
        when: { type: 'string', description: 'Condition expression. Built-ins: "empty", "not_empty". Or an expression using $ (items array) — e.g. "$.length > 3", "some($, @.status == \\"failed\\")"' },
        message: { type: 'string', description: 'Optional reason for halting' },
        _: { type: 'array', items: { type: 'string' } },
      },
      required: ['when'],
    },
  },
  help() {
    return (
      `gate — conditionally halt the pipeline\n\n` +
      `Usage:\n` +
      `  ... | gate --when empty\n` +
      `  ... | gate --when not_empty --message "Items found, stopping"\n` +
      `  ... | gate --when "$.length > 10"\n` +
      `  ... | gate --when "some($, @.status == \\"failed\\")"\n\n` +
      `Built-in conditions:\n` +
      `  empty       — halt when no items arrive\n` +
      `  not_empty   — halt when at least one item arrives\n\n` +
      `Expression conditions:\n` +
      `  $ refers to the collected items array.\n` +
      `  Supports comparison, logic, and functions from the expression engine\n` +
      `  (length, every, some, count, contains, etc.).\n\n` +
      `Behavior:\n` +
      `  If the condition is true, the pipeline is halted and input items are\n` +
      `  passed through as output. If false, items pass through unchanged.\n`
    );
  },
  async run({ input, args }: { input: AsyncIterable<unknown>; args: Record<string, any> }) {
    const condition: string | undefined = args.when ?? args._?.[0];
    if (!condition) throw new Error('gate requires --when <condition>');
    const message: string | undefined = args.message;

    const items: unknown[] = [];
    for await (const item of input) items.push(item);

    let shouldHalt = false;

    if (condition === 'empty') {
      shouldHalt = items.length === 0;
    } else if (condition === 'not_empty') {
      shouldHalt = items.length > 0;
    } else {
      const ast = parseExpr(condition);
      const result = evaluate(ast, items);
      shouldHalt = Boolean(result);
    }

    const output = (async function* () {
      for (const item of items) yield item;
      if (shouldHalt) {
        yield { kind: 'gate' as const, ...(message ? { message } : {}) };
      }
    })();

    return shouldHalt ? { halt: true, output } : { output };
  },
};
