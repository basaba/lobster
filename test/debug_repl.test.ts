import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PassThrough } from 'node:stream';

import { evaluateExpression } from '../src/debug/repl.js';
import { writeDebugSnapshot, readDebugSnapshot } from '../src/debug/snapshot.js';
import { runWorkflowFile } from '../src/workflows/file.js';
import type { DebugSnapshot, WorkflowStepResult } from '../src/workflows/file.js';
import { createDefaultRegistry } from '../src/commands/registry.js';

function createSnapshot(overrides?: Partial<DebugSnapshot>): DebugSnapshot {
  return {
    runId: 'test-run-id',
    timestamp: '2026-01-01T00:00:00.000Z',
    workflowFile: '/tmp/test.lobster',
    workflowName: 'test-workflow',
    args: { name: 'Alice', count: 3 },
    env: { API_URL: 'https://api.example.com', TOKEN: 'secret123' },
    steps: {
      'fetch': {
        id: 'fetch',
        stdout: 'hello world',
        json: { items: [1, 2, 3] },
      },
      'transform': {
        id: 'transform',
        stdout: 'transformed',
        json: { result: 'ok' },
      },
      'skipped-step': {
        id: 'skipped-step',
        skipped: true,
      },
      'failed-step': {
        id: 'failed-step',
        error: true,
        errorMessage: 'something went wrong',
      },
    },
    status: 'ok',
    ...overrides,
  };
}

// --- REPL evaluation tests ---

test('evaluateExpression: $step.stdout returns stdout', () => {
  const snapshot = createSnapshot();
  const result = evaluateExpression('$fetch.stdout', snapshot);
  assert('output' in result);
  assert.equal(result.output, 'hello world');
});

test('evaluateExpression: $step.json returns json', () => {
  const snapshot = createSnapshot();
  const result = evaluateExpression('$fetch.json', snapshot);
  assert('output' in result);
  const parsed = JSON.parse(result.output);
  assert.deepEqual(parsed, { items: [1, 2, 3] });
});

test('evaluateExpression: $step.json.field returns nested field', () => {
  const snapshot = createSnapshot();
  const result = evaluateExpression('$fetch.json.items', snapshot);
  assert('output' in result);
  const parsed = JSON.parse(result.output);
  assert.deepEqual(parsed, [1, 2, 3]);
});

test('evaluateExpression: $step (bare) returns full result', () => {
  const snapshot = createSnapshot();
  const result = evaluateExpression('$fetch', snapshot);
  assert('output' in result);
  const parsed = JSON.parse(result.output);
  assert.equal(parsed.id, 'fetch');
  assert.equal(parsed.stdout, 'hello world');
});

test('evaluateExpression: ${argName} returns arg value', () => {
  const snapshot = createSnapshot();
  const result = evaluateExpression('${name}', snapshot);
  assert('output' in result);
  assert.equal(result.output, 'Alice');
});

test('evaluateExpression: ${argName} returns numeric arg', () => {
  const snapshot = createSnapshot();
  const result = evaluateExpression('${count}', snapshot);
  assert('output' in result);
  assert.equal(result.output, '3');
});

test('evaluateExpression: ${env:VAR} returns env value', () => {
  const snapshot = createSnapshot();
  const result = evaluateExpression('${env:API_URL}', snapshot);
  assert('output' in result);
  assert.equal(result.output, 'https://api.example.com');
});

test('evaluateExpression: .steps lists all steps with statuses', () => {
  const snapshot = createSnapshot();
  const result = evaluateExpression('.steps', snapshot);
  assert('output' in result);
  assert(result.output.includes('fetch — ok'));
  assert(result.output.includes('skipped-step — skipped'));
  assert(result.output.includes('failed-step — error'));
});

test('evaluateExpression: .args dumps all args', () => {
  const snapshot = createSnapshot();
  const result = evaluateExpression('.args', snapshot);
  assert('output' in result);
  const parsed = JSON.parse(result.output);
  assert.deepEqual(parsed, { name: 'Alice', count: 3 });
});

test('evaluateExpression: .env dumps all env', () => {
  const snapshot = createSnapshot();
  const result = evaluateExpression('.env', snapshot);
  assert('output' in result);
  const parsed = JSON.parse(result.output);
  assert.equal(parsed.API_URL, 'https://api.example.com');
});

test('evaluateExpression: .exit returns exit signal', () => {
  const snapshot = createSnapshot();
  const result = evaluateExpression('.exit', snapshot);
  assert('exit' in result);
});

test('evaluateExpression: .quit returns exit signal', () => {
  const snapshot = createSnapshot();
  const result = evaluateExpression('.quit', snapshot);
  assert('exit' in result);
});

test('evaluateExpression: unknown step returns error', () => {
  const snapshot = createSnapshot();
  const result = evaluateExpression('$nonexistent', snapshot);
  assert('error' in result);
  assert(result.error.includes('Unknown step'));
});

test('evaluateExpression: unknown arg returns error', () => {
  const snapshot = createSnapshot();
  const result = evaluateExpression('${missing}', snapshot);
  assert('error' in result);
  assert(result.error.includes('not found'));
});

test('evaluateExpression: unknown env var returns error', () => {
  const snapshot = createSnapshot();
  const result = evaluateExpression('${env:MISSING}', snapshot);
  assert('error' in result);
  assert(result.error.includes('not found'));
});

test('evaluateExpression: .help returns help text', () => {
  const snapshot = createSnapshot();
  const result = evaluateExpression('.help', snapshot);
  assert('output' in result);
  assert(result.output.includes('Debug REPL commands'));
});

test('evaluateExpression: empty input returns empty output', () => {
  const snapshot = createSnapshot();
  const result = evaluateExpression('', snapshot);
  assert('output' in result);
  assert.equal(result.output, '');
});

test('evaluateExpression: unrecognized input returns error', () => {
  const snapshot = createSnapshot();
  const result = evaluateExpression('random text', snapshot);
  assert('error' in result);
  assert(result.error.includes('Unrecognized'));
});

// --- Snapshot I/O tests ---

test('writeDebugSnapshot and readDebugSnapshot round-trip', async () => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lobster-debug-test-'));
  const snapshot = createSnapshot({ runId: 'roundtrip-test' });

  const filePath = await writeDebugSnapshot(snapshot, tmpDir);
  assert(filePath.includes('roundtrip-test.json'));

  const loaded = await readDebugSnapshot(filePath);
  assert.equal(loaded.runId, 'roundtrip-test');
  assert.equal(loaded.workflowName, 'test-workflow');
  assert.deepEqual(loaded.args, snapshot.args);
  assert.deepEqual(loaded.steps.fetch.stdout, 'hello world');

  await fsp.rm(tmpDir, { recursive: true, force: true });
});

test('readDebugSnapshot rejects invalid file', async () => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lobster-debug-test-'));
  const filePath = path.join(tmpDir, 'bad.json');
  await fsp.writeFile(filePath, '{"foo": "bar"}', 'utf8');

  await assert.rejects(
    () => readDebugSnapshot(filePath),
    /missing required fields/,
  );

  await fsp.rm(tmpDir, { recursive: true, force: true });
});

// --- Integration test: --debug flag populates _debug ---

test('runWorkflowFile with debug=true populates _debug snapshot', async () => {
  const workflow = {
    name: 'debug-test',
    args: { greeting: { default: 'hello' } },
    env: { MY_VAR: 'test-value' },
    steps: [
      { id: 'echo-step', run: 'echo "${greeting}"' },
    ],
  };

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lobster-debug-int-'));
  const filePath = path.join(tmpDir, 'workflow.lobster');
  await fsp.writeFile(filePath, JSON.stringify(workflow, null, 2), 'utf8');

  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.setEncoding('utf8');
  stderr.setEncoding('utf8');

  const result = await runWorkflowFile({
    filePath,
    ctx: {
      stdin: process.stdin,
      stdout,
      stderr,
      env: { ...process.env },
      mode: 'human',
      debug: true,
    },
  });

  assert.equal(result.status, 'ok');
  assert(result._debug, '_debug should be populated when debug=true');
  assert.equal(result._debug.workflowName, 'debug-test');
  assert.equal(result._debug.status, 'ok');
  assert.deepEqual(result._debug.args, { greeting: 'hello' });
  assert.deepEqual(result._debug.env, { MY_VAR: 'test-value' });
  assert(result._debug.steps['echo-step'], 'echo-step should be in debug steps');
  assert(result._debug.runId, 'runId should be set');
  assert(result._debug.timestamp, 'timestamp should be set');

  await fsp.rm(tmpDir, { recursive: true, force: true });
});

test('runWorkflowFile without debug=true does not populate _debug', async () => {
  const workflow = {
    name: 'no-debug-test',
    steps: [
      { id: 'echo-step', run: 'echo hi' },
    ],
  };

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lobster-nodebug-'));
  const filePath = path.join(tmpDir, 'workflow.lobster');
  await fsp.writeFile(filePath, JSON.stringify(workflow, null, 2), 'utf8');

  const stdout = new PassThrough();
  const stderr = new PassThrough();

  const result = await runWorkflowFile({
    filePath,
    ctx: {
      stdin: process.stdin,
      stdout,
      stderr,
      env: { ...process.env },
      mode: 'human',
    },
  });

  assert.equal(result.status, 'ok');
  assert.equal(result._debug, undefined, '_debug should not be set without debug flag');

  await fsp.rm(tmpDir, { recursive: true, force: true });
});
