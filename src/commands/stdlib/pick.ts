export const pickCommand = {
  name: 'pick',
  meta: {
    description: 'Project fields from objects',
    argsSchema: {
      type: 'object',
      properties: {
        _: {
          type: 'array',
          items: { type: 'string' },
          description: 'First positional arg is a comma-separated list of fields',
        },
      },
      required: ['_'],
    },
    sideEffects: [],
  },
  help() {
    return `pick — project fields from objects\n\nUsage:\n  ... | pick id,subject,from\n  ... | pick author=from,title   (rename 'from' to 'author')\n`;
  },
  async run({ input, args }) {
    const spec = args._.join(',');
    if (!spec) throw new Error('pick requires a comma-separated field list');
    const fields = spec.split(',').map((s) => s.trim()).filter(Boolean);

    const parsed = fields.map((f) => {
      const eqIdx = f.indexOf('=');
      if (eqIdx > 0) {
        return { outKey: f.slice(0, eqIdx).trim(), srcKey: f.slice(eqIdx + 1).trim() };
      }
      return { outKey: f, srcKey: f };
    });

    return {
      output: (async function* () {
        for await (const item of input) {
          if (item === null || typeof item !== 'object') {
            yield item;
            continue;
          }
          const out = {};
          for (const { outKey, srcKey } of parsed) out[outKey] = item[srcKey];
          yield out;
        }
      })(),
    };
  },
};
