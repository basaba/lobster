import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { createDefaultRegistry } from '../src/commands/registry.js';

function streamOf(items) {
  return (async function* () {
    for (const item of items) yield item;
  })();
}

function makeCtx(env) {
  return {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env,
    registry: createDefaultRegistry(),
    mode: 'tool',
    render: { json() {}, lines() {} },
  };
}

test('diff.gate passes through on first run (always changed)', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'lobster-diffgate-'));
  const env = { ...process.env, LOBSTER_STATE_DIR: tmp };
  const cmd = createDefaultRegistry().get('diff.gate');

  const result = await cmd.run({
    input: streamOf([{ a: 1 }]),
    args: { _: [], key: 'k' },
    ctx: makeCtx(env),
  });

  assert.equal(result.halt, undefined);
  const out = [];
  for await (const it of result.output) out.push(it);
  assert.equal(out[0].changed, true);
  assert.equal(out[0].kind, 'diff.gate');
});

test('diff.gate halts when input is unchanged', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'lobster-diffgate-'));
  const env = { ...process.env, LOBSTER_STATE_DIR: tmp };
  const cmd = createDefaultRegistry().get('diff.gate');

  // First run — stores state
  await cmd.run({
    input: streamOf([{ a: 1 }]),
    args: { _: [], key: 'k2' },
    ctx: makeCtx(env),
  });

  // Second run — same data, should halt
  const result = await cmd.run({
    input: streamOf([{ a: 1 }]),
    args: { _: [], key: 'k2' },
    ctx: makeCtx(env),
  });

  assert.equal(result.halt, true);
  const out = [];
  for await (const it of result.output) out.push(it);
  assert.equal(out[0].changed, false);
});

test('diff.gate passes through when input changes', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'lobster-diffgate-'));
  const env = { ...process.env, LOBSTER_STATE_DIR: tmp };
  const cmd = createDefaultRegistry().get('diff.gate');

  // First run
  await cmd.run({
    input: streamOf([{ a: 1 }]),
    args: { _: [], key: 'k3' },
    ctx: makeCtx(env),
  });

  // Second run — different data, should pass through
  const result = await cmd.run({
    input: streamOf([{ a: 2 }]),
    args: { _: [], key: 'k3' },
    ctx: makeCtx(env),
  });

  assert.equal(result.halt, undefined);
  const out = [];
  for await (const it of result.output) out.push(it);
  assert.equal(out[0].changed, true);
});

test('diff.gate throws when --key is missing', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'lobster-diffgate-'));
  const env = { ...process.env, LOBSTER_STATE_DIR: tmp };
  const cmd = createDefaultRegistry().get('diff.gate');

  await assert.rejects(
    () =>
      cmd.run({
        input: streamOf([{ a: 1 }]),
        args: { _: [] },
        ctx: makeCtx(env),
      }),
    { message: /requires --key/ }
  );
});
