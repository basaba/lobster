function getByPath(obj: any, path: string): any {
  if (!path) return undefined;
  const parts = path.split('.').filter(Boolean);
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

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
    return (
      `pick — project fields from objects\n\n` +
      `Usage:\n` +
      `  ... | pick id,subject,from\n` +
      `  ... | pick author=from,title   (rename 'from' to 'author')\n` +
      `  ... | pick pr.number              (nested → outputs as 'number')\n` +
      `  ... | pick num=pr.number       (nested with explicit name)\n`
    );
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
      if (f.includes('.')) {
        const leaf = f.split('.').filter(Boolean).pop()!;
        return { outKey: leaf, srcKey: f };
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
          for (const { outKey, srcKey } of parsed) {
            out[outKey] = srcKey.includes('.') ? getByPath(item, srcKey) : item[srcKey];
          }
          yield out;
        }
      })(),
    };
  },
};
