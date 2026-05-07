import { defaultStateDir, keyToPath } from '../../state/store.js';
import { promises as fsp } from 'node:fs';

function normalizeFields(arg: unknown): string[] {
  if (Array.isArray(arg)) {
    return arg.flatMap((v) => String(v).split(',').map((s) => s.trim()).filter(Boolean));
  }
  if (typeof arg === 'string') {
    return arg.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return ['id'];
}

function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function compositeKey(item: unknown, fields: string[]): string {
  if (item == null || typeof item !== 'object') return String(item ?? '');
  if (fields.length === 1) return String(getByPath(item, fields[0]) ?? '');
  return fields.map((f) => String(getByPath(item, f) ?? '')).join('\0');
}

export const diffKeyExistsCommand = {
  name: 'diff.key.exists',
  meta: {
    description: 'Check items against diff.key state without modifying it',
    argsSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'State key to check against' },
        field: {
          oneOf: [
            { type: 'string', description: 'Field name to use as the unique key (default: id)' },
            { type: 'array', items: { type: 'string' }, description: 'Multiple field names for composite key' },
          ],
        },
        _: { type: 'array', items: { type: 'string' } },
      },
      required: ['key'],
    },
    sideEffects: [],
  },
  help() {
    return [
      'diff.key.exists — check items against diff.key state without modifying it',
      '',
      'Usage:',
      '  <items> | diff.key.exists --key <stateKey> [--field <fieldName> ...]',
      '',
      'Options:',
      '  --key    State key to check against (required)',
      '  --field  Field name(s) to use as the unique key (default: id)',
      '',
      'Output:',
      '  Each input item with changed: true (not in state) or false (already in state)',
      '',
      'Unlike diff.key, this does NOT update the stored state.',
      '',
      'Example:',
      '  mail.search --unread | diff.key.exists --key inbox --field id',
    ].join('\n');
  },
  async run({ input, args, ctx }) {
    const stateKey: string = args.key ?? args._?.[0];
    if (!stateKey) throw new Error('diff.key.exists requires --key');
    const fields = normalizeFields(args.field);

    const stateDir = defaultStateDir(ctx.env ?? process.env);
    const filePath = keyToPath(stateDir, stateKey);

    let previousKeys = new Set<string>();
    try {
      const text = await fsp.readFile(filePath, 'utf8');
      const arr = JSON.parse(text);
      previousKeys = new Set(Array.isArray(arr) ? arr.map(String) : []);
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err;
    }

    return {
      output: (async function* () {
        for await (const item of input) {
          const keyStr = compositeKey(item, fields);
          yield { ...item, changed: !previousKeys.has(keyStr) };
        }
      })(),
    };
  },
};
