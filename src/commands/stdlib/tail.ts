export const tailCommand = {
  name: 'tail',
  meta: {
    description: 'Take last N items',
    argsSchema: {
      type: 'object',
      properties: {
        n: { type: 'number', description: 'Number of items to take', default: 10 },
        _: { type: 'array', items: { type: 'string' } },
      },
      required: [],
    },
    sideEffects: [],
  },
  help() {
    return `tail — take last N items\n\nUsage:\n  tail --n 10\n`;
  },
  async run({ input, args }) {
    const n = args.n === undefined ? 10 : Number(args.n);
    if (!Number.isFinite(n) || n < 0) throw new Error('tail --n must be a non-negative number');

    return {
      output: (async function* () {
        if (n === 0) return;
        const buf: unknown[] = [];
        for await (const item of input) {
          buf.push(item);
          if (buf.length > n) buf.shift();
        }
        for (const item of buf) yield item;
      })(),
    };
  },
};
