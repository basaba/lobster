import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { createDefaultRegistry } from '../src/commands/registry.js';

function streamOf(items: any[]) {
  return (async function* () {
    for (const item of items) yield item;
  })();
}

function makeCtx(env: Record<string, string>) {
  return {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env,
    registry: createDefaultRegistry(),
    mode: 'tool' as const,
    render: { json() {}, lines() {} },
  };
}

async function collect(iter: AsyncIterable<any>) {
  const out: any[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

test('diff.key with single field (default id)', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'lobster-diffkey-'));
  const env = { ...process.env, LOBSTER_STATE_DIR: tmp } as any;
  const ctx = makeCtx(env);
  const cmd = ctx.registry.get('diff.key');

  // First run: all items are new
  const r1 = await cmd.run({
    input: streamOf([{ id: '1', name: 'a' }, { id: '2', name: 'b' }]),
    args: { key: 'test1' },
    ctx,
  });
  const out1 = await collect(r1.output);
  assert.equal(out1.length, 2);
  assert.equal(out1[0].changed, true);
  assert.equal(out1[1].changed, true);

  // Second run with same items: all seen
  const r2 = await cmd.run({
    input: streamOf([{ id: '1', name: 'a' }, { id: '2', name: 'b' }]),
    args: { key: 'test1' },
    ctx,
  });
  const out2 = await collect(r2.output);
  assert.equal(out2[0].changed, false);
  assert.equal(out2[1].changed, false);
});

test('diff.key with multiple fields via array', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'lobster-diffkey-'));
  const env = { ...process.env, LOBSTER_STATE_DIR: tmp } as any;
  const ctx = makeCtx(env);
  const cmd = ctx.registry.get('diff.key');

  const items = [
    { owner: 'alice', repo: 'foo', number: 1 },
    { owner: 'alice', repo: 'bar', number: 1 },
  ];

  // First run: both new
  const r1 = await cmd.run({
    input: streamOf(items),
    args: { key: 'multi', field: ['owner', 'repo'] },
    ctx,
  });
  const out1 = await collect(r1.output);
  assert.equal(out1[0].changed, true);
  assert.equal(out1[1].changed, true);

  // Second run: same composite keys → seen
  const r2 = await cmd.run({
    input: streamOf(items),
    args: { key: 'multi', field: ['owner', 'repo'] },
    ctx,
  });
  const out2 = await collect(r2.output);
  assert.equal(out2[0].changed, false);
  assert.equal(out2[1].changed, false);

  // Items with same individual field values but different combination → new
  const r3 = await cmd.run({
    input: streamOf([{ owner: 'alice', repo: 'baz', number: 1 }]),
    args: { key: 'multi', field: ['owner', 'repo'] },
    ctx,
  });
  const out3 = await collect(r3.output);
  assert.equal(out3[0].changed, true);
});

test('diff.key with comma-separated fields', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'lobster-diffkey-'));
  const env = { ...process.env, LOBSTER_STATE_DIR: tmp } as any;
  const ctx = makeCtx(env);
  const cmd = ctx.registry.get('diff.key');

  const items = [{ owner: 'bob', repo: 'x', id: 1 }];

  const r1 = await cmd.run({
    input: streamOf(items),
    args: { key: 'csv', field: 'owner,repo' },
    ctx,
  });
  const out1 = await collect(r1.output);
  assert.equal(out1[0].changed, true);

  // Same items with spaces around commas → same composite key, still seen
  const r2 = await cmd.run({
    input: streamOf(items),
    args: { key: 'csv', field: 'owner, repo' },
    ctx,
  });
  const out2 = await collect(r2.output);
  assert.equal(out2[0].changed, false);
});

test('diff.key composite key distinguishes items with same single-field values', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'lobster-diffkey-'));
  const env = { ...process.env, LOBSTER_STATE_DIR: tmp } as any;
  const ctx = makeCtx(env);
  const cmd = ctx.registry.get('diff.key');

  // Two items where individual fields overlap but composite differs
  const r1 = await cmd.run({
    input: streamOf([
      { a: 'x', b: 'y' },
      { a: 'x', b: 'z' },
    ]),
    args: { key: 'composite-dist', field: ['a', 'b'] },
    ctx,
  });
  const out1 = await collect(r1.output);
  assert.equal(out1[0].changed, true);
  assert.equal(out1[1].changed, true);

  // Re-run: only { a:'x', b:'y' } and { a:'x', b:'z' } are seen
  const r2 = await cmd.run({
    input: streamOf([
      { a: 'x', b: 'y' },
      { a: 'x', b: 'z' },
      { a: 'x', b: 'w' }, // new composite
    ]),
    args: { key: 'composite-dist', field: ['a', 'b'] },
    ctx,
  });
  const out2 = await collect(r2.output);
  assert.equal(out2[0].changed, false);
  assert.equal(out2[1].changed, false);
  assert.equal(out2[2].changed, true);
});
