import { diffAndStore } from '../../state/store.js';

export const diffGateCommand = {
  name: 'diff.gate',
  meta: {
    description: 'Compare current items to last snapshot; halt pipeline if unchanged',
    argsSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'State key to diff against' },
        _: { type: 'array', items: { type: 'string' } },
      },
      required: ['key'],
    },
    sideEffects: ['writes_state'],
  },
  help() {
    return `diff.gate — compare current items to last stored snapshot and halt if unchanged\n\nUsage:\n  <items> | diff.gate --key <stateKey>\n\nBehavior:\n  If the data has changed since the last run, the diff result is passed downstream.\n  If the data has NOT changed, the pipeline is halted (remaining stages are skipped).\n\nOutput:\n  { changed, key, before, after }\n`;
  },
  async run({ input, args, ctx }) {
    const key = args.key ?? args._[0];
    if (!key) throw new Error('diff.gate requires --key');

    const afterItems = [];
    for await (const item of input) afterItems.push(item);

    const after = afterItems.length === 1 ? afterItems[0] : afterItems;
    const { before, changed } = await diffAndStore({ env: ctx.env, key, value: after });

    const output = (async function* () {
      yield { kind: 'diff.gate', key, changed, before, after };
    })();

    if (!changed) {
      return { halt: true, output };
    }

    return { output };
  },
};
