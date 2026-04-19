import test from 'node:test';
import assert from 'node:assert/strict';

import { runPipeline } from '../src/runtime.js';
import { createDefaultRegistry } from '../src/commands/registry.js';
import { parsePipeline } from '../src/parser.js';

async function run(pipelineText: string, input: any[]) {
  const pipeline = parsePipeline(pipelineText);
  const registry = createDefaultRegistry();
  const res = await runPipeline({
    pipeline,
    registry,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    mode: 'tool',
    input: (async function* () { for (const x of input) yield x; })(),
  });
  return res.items;
}

test('compute adds a simple computed field', async () => {
  const out = await run("compute total='a + b'", [{ a: 10, b: 20 }]);
  assert.deepEqual(out, [{ a: 10, b: 20, total: 30 }]);
});

test('compute adds multiple fields', async () => {
  const out = await run("compute sum='a + b' product='a * b'", [{ a: 3, b: 4 }]);
  assert.deepEqual(out, [{ a: 3, b: 4, sum: 7, product: 12 }]);
});

test('compute with every() for reviewer vote check', async () => {
  const prs = [
    { id: 1, reviewers: [{ vote: 0 }, { vote: 0 }] },
    { id: 2, reviewers: [{ vote: 0 }, { vote: 10 }] },
  ];
  const out = await run("compute unreviewed='every(reviewers, @.vote == 0)'", prs);
  assert.equal(out[0].unreviewed, true);
  assert.equal(out[1].unreviewed, false);
});

test('compute with some()', async () => {
  const out = await run("compute has_approved='some(reviewers, @.vote == 10)'", [
    { reviewers: [{ vote: 0 }, { vote: 10 }] },
    { reviewers: [{ vote: 0 }, { vote: 0 }] },
  ]);
  assert.equal(out[0].has_approved, true);
  assert.equal(out[1].has_approved, false);
});

test('compute with string functions', async () => {
  const out = await run("compute full='concat(first, \" \", last)' low='lower(first)'", [
    { first: 'Alice', last: 'Smith' },
  ]);
  assert.equal(out[0].full, 'Alice Smith');
  assert.equal(out[0].low, 'alice');
});

test('compute with length()', async () => {
  const out = await run("compute n='length(items)'", [{ items: [1, 2, 3] }]);
  assert.equal(out[0].n, 3);
});

test('compute wraps non-object items', async () => {
  // Non-object items (e.g. number 5) are wrapped as {value: 5}.
  // The expression evaluates against the original item, so use $ for root access.
  const out = await run("compute doubled='$ * 2'", [5]);
  assert.deepEqual(out, [{ value: 5, doubled: 10 }]);
});

test('compute with boolean expression', async () => {
  const out = await run("compute active='status == \"open\" && count > 0'", [
    { status: 'open', count: 5 },
    { status: 'closed', count: 5 },
    { status: 'open', count: 0 },
  ]);
  assert.equal(out[0].active, true);
  assert.equal(out[1].active, false);
  assert.equal(out[2].active, false);
});

test('compute with coalesce()', async () => {
  const out = await run("compute name='coalesce(displayName, login, \"unknown\")'", [
    { displayName: 'Alice' },
    { login: 'bob' },
    {},
  ]);
  assert.equal(out[0].name, 'Alice');
  assert.equal(out[1].name, 'bob');
  assert.equal(out[2].name, 'unknown');
});

test('compute errors on no assignments', async () => {
  await assert.rejects(() => run('compute', [{ a: 1 }]), /requires/);
});

test('compute preserves original fields', async () => {
  const out = await run("compute c='a + b'", [{ a: 1, b: 2, other: 'keep' }]);
  assert.equal(out[0].other, 'keep');
  assert.equal(out[0].c, 3);
});
