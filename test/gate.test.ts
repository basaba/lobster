import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDefaultRegistry } from '../src/commands/registry.js';
import { runWorkflowFile } from '../src/workflows/file.js';

async function runWorkflow(workflow: unknown) {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lobster-gate-'));
  const stateDir = path.join(tmpDir, 'state');
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

test('gate --when empty halts when no items', async () => {
  const result = await runWorkflow({
    steps: [
      { id: 'data', command: 'node -e "process.stdout.write(JSON.stringify([]))"' },
      { id: 'check', pipeline: 'gate --when empty --message "No items"', stdin: '$data.json' },
      { id: 'after', command: 'echo should_not_run' },
    ],
  });
  assert.equal(result.status, 'ok');
  // gate halted, so 'after' step should not have run
  assert.equal(result.output.length, 0);
});

test('gate --when empty does not halt when items exist', async () => {
  const result = await runWorkflow({
    steps: [
      { id: 'data', command: 'node -e "process.stdout.write(JSON.stringify([1,2,3]))"' },
      { id: 'check', pipeline: 'gate --when empty', stdin: '$data.json' },
      { id: 'after', command: 'node -e "process.stdout.write(JSON.stringify({ran:true}))"' },
    ],
  });
  assert.equal(result.status, 'ok');
  const output = result.output as any[];
  assert.equal(output[0].ran, true);
});

test('gate --when not_empty halts when items exist', async () => {
  const result = await runWorkflow({
    steps: [
      { id: 'data', command: 'node -e "process.stdout.write(JSON.stringify([1]))"' },
      { id: 'check', pipeline: 'gate --when not_empty', stdin: '$data.json' },
      { id: 'after', command: 'echo should_not_run' },
    ],
  });
  assert.equal(result.status, 'ok');
});

test('gate --when not_empty does not halt when no items', async () => {
  const result = await runWorkflow({
    steps: [
      { id: 'data', command: 'node -e "process.stdout.write(JSON.stringify([]))"' },
      { id: 'check', pipeline: 'gate --when not_empty', stdin: '$data.json' },
      { id: 'after', command: 'node -e "process.stdout.write(JSON.stringify({ran:true}))"' },
    ],
  });
  assert.equal(result.status, 'ok');
  const output = result.output as any[];
  assert.equal(output[0].ran, true);
});

test('gate with expression condition halts when true', async () => {
  const result = await runWorkflow({
    steps: [
      { id: 'data', command: 'node -e "process.stdout.write(JSON.stringify([{s:\\"fail\\"},{s:\\"ok\\"}]))"' },
      { id: 'check', pipeline: 'gate --when "some($, @.s == \\"fail\\")" --message "Has failures"', stdin: '$data.json' },
      { id: 'after', command: 'echo should_not_run' },
    ],
  });
  assert.equal(result.status, 'ok');
});

test('gate with expression condition passes when false', async () => {
  const result = await runWorkflow({
    steps: [
      { id: 'data', command: 'node -e "process.stdout.write(JSON.stringify([{s:\\"ok\\"},{s:\\"ok\\"}]))"' },
      { id: 'check', pipeline: 'gate --when "some($, @.s == \\"fail\\")"', stdin: '$data.json' },
      { id: 'after', command: 'node -e "process.stdout.write(JSON.stringify({ran:true}))"' },
    ],
  });
  assert.equal(result.status, 'ok');
  const output = result.output as any[];
  assert.equal(output[0].ran, true);
});

test('gate preserves input items when halting', async () => {
  const result = await runWorkflow({
    steps: [
      { id: 'data', command: 'node -e "process.stdout.write(JSON.stringify([10,20]))"' },
      { id: 'check', pipeline: 'gate --when not_empty', stdin: '$data.json' },
    ],
  });
  assert.equal(result.status, 'ok');
  const output = result.output as any;
  assert.deepEqual(output, [10, 20]);
});

test('gate with length expression', async () => {
  const result = await runWorkflow({
    steps: [
      { id: 'data', command: 'node -e "process.stdout.write(JSON.stringify([1,2,3,4,5]))"' },
      { id: 'check', pipeline: 'gate --when "length($) > 3"', stdin: '$data.json' },
      { id: 'after', command: 'echo should_not_run' },
    ],
  });
  assert.equal(result.status, 'ok');
});
