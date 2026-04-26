export const breakCommand = {
  name: 'break',
  meta: {
    description: 'Halt the pipeline (or workflow) immediately',
    argsSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Optional reason for breaking' },
        _: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  help() {
    return (
      `break — halt the pipeline or workflow immediately\n\n` +
      `Usage:\n` +
      `  break\n` +
      `  break --message "Nothing to process"\n` +
      `  ... | break --message "Done early"\n\n` +
      `Behavior:\n` +
      `  Halts the pipeline so remaining stages are skipped.\n` +
      `  Any stdin items are passed through as output before halting.\n` +
      `  In a workflow, the step result includes { kind: "break" } and\n` +
      `  the workflow stops with status "ok".\n`
    );
  },
  async run({ input, args }: { input: AsyncIterable<unknown>; args: Record<string, any> }) {
    const message: string | undefined = args.message ?? args._?.[0];

    const output = (async function* () {
      for await (const item of input) yield item;
      yield { kind: 'break' as const, ...(message ? { message } : {}) };
    })();

    return { halt: true, output };
  },
};
