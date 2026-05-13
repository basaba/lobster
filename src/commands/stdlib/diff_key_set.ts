import { defaultStateDir, keyToPath } from '../../state/store.js';
import { promises as fsp } from 'node:fs';

async function readKeySet(stateDir: string, stateKey: string): Promise<Set<string>> {
  const filePath = keyToPath(stateDir, stateKey);
  try {
    const text = await fsp.readFile(filePath, 'utf8');
    const arr = JSON.parse(text);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return new Set();
    throw err;
  }
}

async function writeKeySet(stateDir: string, stateKey: string, keys: Set<string>): Promise<void> {
  await fsp.mkdir(stateDir, { recursive: true });
  await fsp.writeFile(
    keyToPath(stateDir, stateKey),
    JSON.stringify([...keys], null, 2) + '\n',
    'utf8',
  );
}

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

export const diffKeySetCommand = {
  name: 'diff.key.set',
  meta: {
    description: 'Store item keys into diff.key state without annotating items',
    argsSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'State key to store values under' },
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
    sideEffects: ['writes_state'],
  },
  help() {
    return [
      'diff.key.set — store item keys into diff.key state without annotating items',
      '',
      'Usage:',
      '  <items> | diff.key.set --key <stateKey> [--field <fieldName> ...]',
      '',
      'Options:',
      '  --key    State key to store values under (required)',
      '  --field  Field name(s) to use as the unique key (default: id)',
      '          Pass multiple times or comma-separated for composite keys:',
      '            --field owner --field repo',
      '            --field owner,repo',
      '',
      'Output:',
      '  Input items are passed through unchanged (no changed field added).',
      '  State is updated to include all input item keys (merged with existing).',
      '',
      'Use with diff.key.exists for two-phase check-then-commit patterns:',
      '',
      'Example:',
      '  # Phase 1: check which items are new (no state mutation)',
      '  items | diff.key.exists --key mykey --field id | where changed==true',
      '  # Phase 2: after processing, commit the state',
      '  items | diff.key.set --key mykey --field id',
    ].join('\n');
  },
  async run({ input, args, ctx }) {
    const stateKey: string = args.key ?? args._?.[0];
    if (!stateKey) throw new Error('diff.key.set requires --key');
    const fields = normalizeFields(args.field);

    const stateDir = defaultStateDir(ctx.env ?? process.env);
    const previousKeys = await readKeySet(stateDir, stateKey);

    const items: any[] = [];
    for await (const item of input) items.push(item);

    const mergedKeys = new Set<string>(previousKeys);
    for (const item of items) {
      mergedKeys.add(compositeKey(item, fields));
    }

    await writeKeySet(stateDir, stateKey, mergedKeys);

    return {
      output: (async function* () {
        for (const item of items) yield item;
      })(),
    };
  },
};
