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

function compositeKey(item: unknown, fields: string[]): string {
  if (item == null || typeof item !== 'object') return String(item ?? '');
  if (fields.length === 1) return String((item as any)[fields[0]] ?? '');
  return fields.map((f) => String((item as any)[f] ?? '')).join('\0');
}

export const diffKeyCommand = {
  name: 'diff.key',
  meta: {
    description: 'Mark items as new/seen by comparing a key field against stored state',
    argsSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'State key to track seen values' },
        field: {
          oneOf: [
            { type: 'string', description: 'Field name to use as the unique key (default: id)' },
            { type: 'array', items: { type: 'string' }, description: 'Multiple field names to form a composite key' },
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
      'diff.key — mark items as new/seen by comparing a key field against stored state',
      '',
      'Usage:',
      '  <items> | diff.key --key <stateKey> [--field <fieldName> ...]',
      '',
      'Options:',
      '  --key    State key to track seen values (required)',
      '  --field  Field name(s) to use as the unique key (default: id)',
      '          Pass multiple times or comma-separated for composite keys:',
      '            --field owner --field repo',
      '            --field owner,repo',
      '',
      'Output:',
      '  Each input item with changed: true (new) or false (seen before)',
      '',
      'Example:',
      '  mail.search --unread | diff.key --key inbox --field id | where changed==true',
      '  gh.pulls | diff.key --key prs --field owner,repo,number | where changed==true',
    ].join('\n');
  },
  async run({ input, args, ctx }) {
    const stateKey: string = args.key ?? args._?.[0];
    if (!stateKey) throw new Error('diff.key requires --key');
    const fields = normalizeFields(args.field);

    const stateDir = defaultStateDir(ctx.env ?? process.env);
    const previousKeys = await readKeySet(stateDir, stateKey);

    const items: any[] = [];
    for await (const item of input) items.push(item);

    const currentKeys = new Set<string>();
    const output = items.map((item) => {
      const keyStr = compositeKey(item, fields);
      currentKeys.add(keyStr);
      return { ...item, changed: !previousKeys.has(keyStr) };
    });

    await writeKeySet(stateDir, stateKey, currentKeys);

    return {
      output: (async function* () {
        for (const item of output) yield item;
      })(),
    };
  },
};
