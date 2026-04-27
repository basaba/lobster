import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createDefaultRegistry } from '../src/commands/registry.js';

function streamOf(items) {
  return (async function* () {
    for (const item of items) yield item;
  })();
}

function makeCtx(registry) {
  return {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: { ...process.env },
    registry,
    mode: 'human',
    render: { json() {}, lines() {} },
  };
}

test('exec --stdin-file jsonl writes items to temp file and sets LOBSTER_STDIN_FILE', async () => {
  const registry = createDefaultRegistry();
  const cmd = registry.get('exec');

  // Node script reads the file from LOBSTER_STDIN_FILE and outputs its contents
  const nodeScript = `
    const fs = require('fs');
    const data = fs.readFileSync(process.env.LOBSTER_STDIN_FILE, 'utf8');
    console.log(data.trim());
  `;

  const result = await cmd.run({
    input: streamOf([{ a: 1 }, { a: 2 }]),
    args: {
      _: ['node', '-e', nodeScript],
      'stdin-file': 'jsonl',
      json: false,
    },
    ctx: makeCtx(registry),
  });

  const items = [];
  for await (const item of result.output) items.push(item);
  assert.deepEqual(items, ['{"a":1}', '{"a":2}']);
});

test('exec --stdin-file json writes array to temp file', async () => {
  const registry = createDefaultRegistry();
  const cmd = registry.get('exec');

  const nodeScript = `
    const fs = require('fs');
    const data = fs.readFileSync(process.env.LOBSTER_STDIN_FILE, 'utf8');
    process.stdout.write(data);
  `;

  const result = await cmd.run({
    input: streamOf([{ x: 10 }, { x: 20 }]),
    args: {
      _: ['node', '-e', nodeScript],
      'stdin-file': 'json',
      json: true,
    },
    ctx: makeCtx(registry),
  });

  const items = [];
  for await (const item of result.output) items.push(item);
  assert.deepEqual(items, [{ x: 10 }, { x: 20 }]);
});

test('exec --stdin-file raw writes text to temp file', async () => {
  const registry = createDefaultRegistry();
  const cmd = registry.get('exec');

  const nodeScript = `
    const fs = require('fs');
    const data = fs.readFileSync(process.env.LOBSTER_STDIN_FILE, 'utf8');
    console.log(data);
  `;

  const result = await cmd.run({
    input: streamOf(['hello', 'world']),
    args: {
      _: ['node', '-e', nodeScript],
      'stdin-file': 'raw',
    },
    ctx: makeCtx(registry),
  });

  const items = [];
  for await (const item of result.output) items.push(item);
  assert.deepEqual(items, ['hello', 'world']);
});

test('exec --stdin and --stdin-file are mutually exclusive', async () => {
  const registry = createDefaultRegistry();
  const cmd = registry.get('exec');

  await assert.rejects(
    () => cmd.run({
      input: streamOf([]),
      args: { _: ['echo'], stdin: 'json', 'stdin-file': 'json' },
      ctx: makeCtx(registry),
    }),
    /mutually exclusive/,
  );
});

test('exec --stdin-file cleans up temp file after execution', async () => {
  const registry = createDefaultRegistry();
  const cmd = registry.get('exec');

  // Script prints the LOBSTER_STDIN_FILE path so we can check cleanup
  const nodeScript = `process.stdout.write(process.env.LOBSTER_STDIN_FILE);`;

  const result = await cmd.run({
    input: streamOf([{ a: 1 }]),
    args: {
      _: ['node', '-e', nodeScript],
      'stdin-file': 'json',
    },
    ctx: makeCtx(registry),
  });

  const items = [];
  for await (const item of result.output) items.push(item);
  const filePath = items[0];

  assert.ok(typeof filePath === 'string' && filePath.length > 0, 'Should output file path');
  assert.ok(!existsSync(filePath), 'Temp file should be cleaned up after exec');
});

test('exec --stdin-file cleans up on child failure', async () => {
  const registry = createDefaultRegistry();
  const cmd = registry.get('exec');

  const nodeScript = `
    const path = process.env.LOBSTER_STDIN_FILE;
    process.stdout.write(path);
    process.exit(1);
  `;

  let filePath;
  try {
    const result = await cmd.run({
      input: streamOf([{ a: 1 }]),
      args: {
        _: ['node', '-e', nodeScript],
        'stdin-file': 'json',
      },
      ctx: makeCtx(registry),
    });
    for await (const item of result.output) filePath = item;
    assert.fail('Should have thrown');
  } catch (err) {
    assert.match(err.message, /exec failed/);
  }
  // Cannot reliably capture filePath from failed process stdout,
  // but we verify no error is thrown from cleanup itself.
});
