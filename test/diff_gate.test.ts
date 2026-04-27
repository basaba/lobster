import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import { createDefaultRegistry } from '../src/commands/registry.js';
import { runWorkflowFile } from '../src/workflows/file.js';

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

async function runWorkflow(workflow: unknown, stateDir: string) {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lobster-diffgate-wf-'));
  const filePath = path.join(tmpDir, 'workflow.lobster');
  await fsp.writeFile(filePath, JSON.stringify(workflow, null, 2), 'utf8');

  return runWorkflowFile({
    filePath,
    ctx: {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      env: { ...process.env, LOBSTER_STATE_DIR: stateDir },
      mode: 'tool',
      registry: createDefaultRegistry(),
    },
  });
}

test('diff.gate halt does not fail workflow', async () => {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), 'lobster-diffgate-state-'));

  // First run — data is new, workflow should complete all steps
  const result1 = await runWorkflow({
    steps: [
      { id: 'data', command: 'node -e "process.stdout.write(JSON.stringify({v:1}))"' },
      { id: 'gate', pipeline: 'diff.gate --key wftest', stdin: '$data.json' },
      { id: 'after', command: 'echo "ran"' },
    ],
  }, stateDir);
  assert.equal(result1.status, 'ok');
  assert.ok(result1.output.length >= 1, 'should have output from completed steps');

  // Second run — same data, diff.gate should halt gracefully (not throw)
  const result2 = await runWorkflow({
    steps: [
      { id: 'data', command: 'node -e "process.stdout.write(JSON.stringify({v:1}))"' },
      { id: 'gate', pipeline: 'diff.gate --key wftest', stdin: '$data.json' },
      { id: 'after', command: 'echo "should not run"' },
    ],
  }, stateDir);
  assert.equal(result2.status, 'ok');
  // The "after" step should not appear in output since diff.gate halted
  const hasAfterOutput = result2.output.some(
    (o: unknown) => typeof o === 'string' && o.includes('should not run'),
  );
  assert.ok(!hasAfterOutput, 'step after diff.gate halt should not have run');
});
