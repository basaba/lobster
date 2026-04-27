import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { runWorkflowFile } from '../src/workflows/file.js';
import { createDefaultRegistry } from '../src/commands/registry.js';

test('workflow ${env:VAR} resolves environment variables in run commands', async () => {
  const workflow = {
    name: 'env-ref',
    steps: [
      {
        id: 'echo',
        command: 'node -e "process.stdout.write(process.argv[1])" -- "${env:MY_CUSTOM_VAR}"',
      },
    ],
  };

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lobster-env-ref-'));
  const stateDir = path.join(tmpDir, 'state');
  const filePath = path.join(tmpDir, 'workflow.lobster');
  await fsp.writeFile(filePath, JSON.stringify(workflow, null, 2), 'utf8');

  const env = { ...process.env, LOBSTER_STATE_DIR: stateDir, MY_CUSTOM_VAR: 'hello-from-env' };

  const result = await runWorkflowFile({
    filePath,
    args: {},
    ctx: {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      env,
      mode: 'tool',
    },
  });

  assert.equal(result.status, 'ok');
  assert.deepEqual(result.output, ['hello-from-env']);
});

test('workflow ${env:VAR} leaves literal if env var not set', async () => {
  // When an env var is not found, the literal ${env:VAR} remains.
  // Use node command to capture the resolved value without shell interference.
  const workflow = {
    name: 'env-ref-missing',
    steps: [
      {
        id: 'echo',
        command: 'node -e "process.stdout.write(JSON.stringify({val: process.env.LOBSTER_ARG_MARKER}))"',
        env: {
          LOBSTER_ARG_MARKER: '${env:TOTALLY_MISSING_VAR_12345}',
        },
      },
    ],
  };

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lobster-env-ref-'));
  const stateDir = path.join(tmpDir, 'state');
  const filePath = path.join(tmpDir, 'workflow.lobster');
  await fsp.writeFile(filePath, JSON.stringify(workflow, null, 2), 'utf8');

  const env = { ...process.env, LOBSTER_STATE_DIR: stateDir };
  delete env['TOTALLY_MISSING_VAR_12345'];

  const result = await runWorkflowFile({
    filePath,
    args: {},
    ctx: {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      env,
      mode: 'tool',
      registry: createDefaultRegistry(),
    },
  });

  assert.equal(result.status, 'ok');
  assert.deepEqual(result.output, [{ val: '${env:TOTALLY_MISSING_VAR_12345}' }]);
});

test('workflow ${env:VAR} works in env block values', async () => {
  const workflow = {
    name: 'env-ref-in-env',
    env: {
      DERIVED: '${env:BASE_VAR}-suffix',
    },
    steps: [
      {
        id: 'echo',
        command: 'node -e "process.stdout.write(process.env.DERIVED)"',
      },
    ],
  };

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lobster-env-ref-'));
  const stateDir = path.join(tmpDir, 'state');
  const filePath = path.join(tmpDir, 'workflow.lobster');
  await fsp.writeFile(filePath, JSON.stringify(workflow, null, 2), 'utf8');

  const env = { ...process.env, LOBSTER_STATE_DIR: stateDir, BASE_VAR: 'base-value' };

  const result = await runWorkflowFile({
    filePath,
    args: {},
    ctx: {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      env,
      mode: 'tool',
    },
  });

  assert.equal(result.status, 'ok');
  assert.deepEqual(result.output, ['base-value-suffix']);
});

test('workflow ${env:VAR} works in cwd', async () => {
  const workflow = {
    name: 'env-ref-cwd',
    steps: [
      {
        id: 'pwd',
        cwd: '${env:LOBSTER_TEST_CWD}',
        run: 'node -e "process.stdout.write(process.cwd())"',
      },
    ],
  };

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lobster-env-ref-'));
  const stateDir = path.join(tmpDir, 'state');
  const filePath = path.join(tmpDir, 'workflow.lobster');
  await fsp.writeFile(filePath, JSON.stringify(workflow, null, 2), 'utf8');

  // Use resolved tmpDir path to avoid symlink issues on macOS
  const resolvedTmpDir = await fsp.realpath(tmpDir);
  const env = { ...process.env, LOBSTER_STATE_DIR: stateDir, LOBSTER_TEST_CWD: resolvedTmpDir };

  const result = await runWorkflowFile({
    filePath,
    args: {},
    ctx: {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      env,
      mode: 'tool',
    },
  });

  assert.equal(result.status, 'ok');
  assert.deepEqual(result.output, [resolvedTmpDir]);
});

test('workflow ${arg} still works alongside ${env:VAR}', async () => {
  const workflow = {
    name: 'mixed-refs',
    args: {
      greeting: { default: 'hi' },
    },
    steps: [
      {
        id: 'echo',
        command: 'node -e "process.stdout.write(process.argv[1] + \' \' + process.argv[2])" -- "${greeting}" "${env:MY_NAME}"',
      },
    ],
  };

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lobster-env-ref-'));
  const stateDir = path.join(tmpDir, 'state');
  const filePath = path.join(tmpDir, 'workflow.lobster');
  await fsp.writeFile(filePath, JSON.stringify(workflow, null, 2), 'utf8');

  const env = { ...process.env, LOBSTER_STATE_DIR: stateDir, MY_NAME: 'world' };

  const result = await runWorkflowFile({
    filePath,
    args: { greeting: 'hello' },
    ctx: {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      env,
      mode: 'tool',
    },
  });

  assert.equal(result.status, 'ok');
  assert.deepEqual(result.output, ['hello world']);
});

test('workflow arg defaults resolve ${env:VAR}', async () => {
  const workflow = {
    name: 'env-arg-default',
    args: {
      token: { default: '${env:MY_SECRET_TOKEN}' },
    },
    steps: [
      {
        id: 'echo',
        command: 'node -e "process.stdout.write(process.argv[1])" -- "${token}"',
      },
    ],
  };

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lobster-env-ref-'));
  const stateDir = path.join(tmpDir, 'state');
  const filePath = path.join(tmpDir, 'workflow.lobster');
  await fsp.writeFile(filePath, JSON.stringify(workflow, null, 2), 'utf8');

  const env = { ...process.env, LOBSTER_STATE_DIR: stateDir, MY_SECRET_TOKEN: 'secret123' };

  const result = await runWorkflowFile({
    filePath,
    args: {},
    ctx: {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      env,
      mode: 'tool',
    },
  });

  assert.equal(result.status, 'ok');
  assert.deepEqual(result.output, ['secret123']);
});

test('workflow arg default ${env:VAR} is overridden by provided arg', async () => {
  const workflow = {
    name: 'env-arg-override',
    args: {
      token: { default: '${env:MY_SECRET_TOKEN}' },
    },
    steps: [
      {
        id: 'echo',
        command: 'node -e "process.stdout.write(process.argv[1])" -- "${token}"',
      },
    ],
  };

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lobster-env-ref-'));
  const stateDir = path.join(tmpDir, 'state');
  const filePath = path.join(tmpDir, 'workflow.lobster');
  await fsp.writeFile(filePath, JSON.stringify(workflow, null, 2), 'utf8');

  const env = { ...process.env, LOBSTER_STATE_DIR: stateDir, MY_SECRET_TOKEN: 'secret123' };

  const result = await runWorkflowFile({
    filePath,
    args: { token: 'explicit-value' },
    ctx: {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      env,
      mode: 'tool',
    },
  });

  assert.equal(result.status, 'ok');
  assert.deepEqual(result.output, ['explicit-value']);
});
