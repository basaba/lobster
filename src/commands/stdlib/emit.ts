export const emitCommand = {
  name: 'emit',
  meta: {
    description: 'Emit literal values as stream items (no shell needed)',
    argsSchema: {
      type: 'object',
      properties: {
        json: { type: 'boolean', description: 'Parse each positional argument as JSON' },
        _: { type: 'array', items: { type: 'string' }, description: 'Values to emit' },
      },
      required: [],
    },
    sideEffects: [],
  },
  help() {
    return (
      `emit — produce literal values as stream items\n\n` +
      `Usage:\n` +
      `  emit hello world              # yields "hello", "world"\n` +
      `  emit --json '{"a":1}' '{"b":2}'  # yields objects {a:1}, {b:2}\n` +
      `  emit --json '[1,2,3]'         # yields array [1,2,3] as single item\n\n` +
      `Notes:\n` +
      `  - Without --json, each argument is emitted as a string.\n` +
      `  - With --json, each argument is parsed as JSON.\n` +
      `  - If no arguments given, emits nothing (empty stream).\n`
    );
  },
  async run({ args }: any) {
    const positional: string[] = Array.isArray(args._) ? args._ : [];
    const asJson = Boolean(args.json);

    return {
      output: (async function* () {
        for (const val of positional) {
          if (asJson) {
            yield JSON.parse(val);
          } else {
            yield val;
          }
        }
      })(),
    };
  },
};
