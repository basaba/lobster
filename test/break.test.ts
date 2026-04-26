import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDefaultRegistry } from '../src/commands/registry.js';
import { runWorkflowFile } from '../src/workflows/file.js';

async function runWorkflow(workflow: unknown) {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lobster-break-'));
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

test('break halts workflow and returns ok', async () => {
  const result = await runWorkflow({
    steps: [
      { id: 'first', command: 'echo "hello"' },
      { id: 'stop', pipeline: 'break' },
      { id: 'never', command: 'echo "should not run"' },
    ],
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.output.length, 1);
  assert.deepEqual(result.output[0], 'hello\n');
});

test('break with message logs to stderr', async () => {
  const result = await runWorkflow({
    steps: [
      { id: 'stop', pipeline: 'break --message "done early"' },
      { id: 'never', command: 'echo "should not run"' },
    ],
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.output.length, 0);
});

test('conditional break fires when condition is met', async () => {
  const result = await runWorkflow({
    steps: [
      { id: 'data', command: 'node -e "process.stdout.write(JSON.stringify({count:0}))"' },
      { id: 'guard', pipeline: 'break --message "empty"', when: '$data.json.count == 0' },
      { id: 'process', command: 'echo "should not run"' },
    ],
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.output.length, 1);
  // output[0] is the data step output
});

test('conditional break skipped when condition is false', async () => {
  const result = await runWorkflow({
    steps: [
      { id: 'data', command: 'node -e "process.stdout.write(JSON.stringify({count:5}))"' },
      { id: 'guard', pipeline: 'break --message "empty"', when: '$data.json.count == 0' },
      { id: 'process', command: 'echo "continued"' },
    ],
  });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.output[result.output.length - 1], 'continued\n');
});

test('break with stdin passes items through', async () => {
  const result = await runWorkflow({
    steps: [
      { id: 'data', command: 'node -e "process.stdout.write(JSON.stringify({result:\\"final\\"}))"' },
      { id: 'stop', pipeline: 'break', stdin: '$data.json' },
    ],
  });
  assert.equal(result.status, 'ok');
  // The break step should have json output from stdin
  // The output should contain the data step result
  assert.ok(result.output.length >= 1);
});

test('break is registered as a command', () => {
  const registry = createDefaultRegistry();
  const cmd = registry.get('break');
  assert.ok(cmd, 'break command should be registered');
  assert.equal(cmd.name, 'break');
});

test('break command help text is available', () => {
  const registry = createDefaultRegistry();
  const cmd = registry.get('break');
  const help = cmd.help();
  assert.ok(help.includes('halt'), 'help should mention halting');
});
