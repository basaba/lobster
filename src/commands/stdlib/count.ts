export const countCommand = {
  name: 'count',
  meta: {
    description: 'Count items in the stream',
    argsSchema: {
      type: 'object',
      properties: {
        _: { type: 'array', items: { type: 'string' } },
      },
      required: [],
    },
    sideEffects: [],
  },
  help() {
    return `count — count items in the stream\n\nUsage:\n  ... | count\n\nOutputs a single item: { count: <number> }\n`;
  },
  async run({ input }) {
    return {
      output: (async function* () {
        let n = 0;
        for await (const _item of input) n++;
        yield { count: n };
      })(),
    };
  },
};
