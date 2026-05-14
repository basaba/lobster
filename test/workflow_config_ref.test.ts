import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { runWorkflowFile } from '../src/workflows/file.js';

async function setupWorkflow(workflow: object) {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lobster-config-ref-'));
  const stateDir = path.join(tmpDir, 'state');
  const filePath = path.join(tmpDir, 'workflow.lobster');
  await fsp.writeFile(filePath, JSON.stringify(workflow, null, 2), 'utf8');
  return { tmpDir, stateDir, filePath };
}

async function setupGlobals(tmpDir: string, globals: Record<string, string>) {
  const globalsPath = path.join(tmpDir, 'globals.json');
  await fsp.writeFile(globalsPath, JSON.stringify(globals), 'utf8');
  return globalsPath;
}

test('workflow ${config:KEY} resolves global config values in run commands', async () => {
  const workflow = {
    name: 'config-ref',
    steps: [
      {
        id: 'echo',
        command: 'node -e "process.stdout.write(process.argv[1])" -- "${config:cluster}"',
      },
    ],
  };

  const { tmpDir, stateDir, filePath } = await setupWorkflow(workflow);
  const globalsPath = await setupGlobals(tmpDir, { cluster: 'my-cluster-01' });

  const env = { ...process.env, LOBSTER_STATE_DIR: stateDir, LOBSTER_GLOBALS_FILE: globalsPath };

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
  assert.deepEqual(result.output, ['my-cluster-01']);
  await fsp.rm(tmpDir, { recursive: true });
});

test('workflow ${config:KEY} leaves literal if key not found', async () => {
  const workflow = {
    name: 'config-ref-missing',
    steps: [
      {
        id: 'echo',
        command: 'node -e "process.stdout.write(JSON.stringify({val: process.env.LOBSTER_ARG_MARKER}))"',
        env: {
          LOBSTER_ARG_MARKER: '${config:NONEXISTENT_KEY}',
        },
      },
    ],
  };

  const { tmpDir, stateDir, filePath } = await setupWorkflow(workflow);
  const globalsPath = await setupGlobals(tmpDir, { other: 'value' });

  const env = { ...process.env, LOBSTER_STATE_DIR: stateDir, LOBSTER_GLOBALS_FILE: globalsPath };

  const result = await runWorkflowFile({
    filePath,
    args: {},
    ctx: {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      env,
      mode: 'tool',
      registry: (await import('../src/commands/registry.js')).createDefaultRegistry(),
    },
  });

  assert.equal(result.status, 'ok');
  assert.deepEqual(result.output, [{ val: '${config:NONEXISTENT_KEY}' }]);
  await fsp.rm(tmpDir, { recursive: true });
});

test('workflow ${config:KEY} works in env block values', async () => {
  const workflow = {
    name: 'config-ref-env',
    env: {
      DERIVED: '${config:base_url}/api/v2',
    },
    steps: [
      {
        id: 'echo',
        command: 'node -e "process.stdout.write(process.env.DERIVED)"',
      },
    ],
  };

  const { tmpDir, stateDir, filePath } = await setupWorkflow(workflow);
  const globalsPath = await setupGlobals(tmpDir, { base_url: 'https://example.com' });

  const env = { ...process.env, LOBSTER_STATE_DIR: stateDir, LOBSTER_GLOBALS_FILE: globalsPath };

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
  assert.deepEqual(result.output, ['https://example.com/api/v2']);
  await fsp.rm(tmpDir, { recursive: true });
});

test('workflow ${config:KEY} works alongside ${env:VAR} and ${arg}', async () => {
  const workflow = {
    name: 'mixed-refs',
    args: {
      greeting: { default: 'hi' },
    },
    steps: [
      {
        id: 'echo',
        command: 'node -e "process.stdout.write(process.argv[1] + \' \' + process.argv[2] + \' \' + process.argv[3])" -- "${greeting}" "${env:MY_NAME}" "${config:team}"',
      },
    ],
  };

  const { tmpDir, stateDir, filePath } = await setupWorkflow(workflow);
  const globalsPath = await setupGlobals(tmpDir, { team: 'platform' });

  const env = { ...process.env, LOBSTER_STATE_DIR: stateDir, LOBSTER_GLOBALS_FILE: globalsPath, MY_NAME: 'world' };

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
  assert.deepEqual(result.output, ['hello world platform']);
  await fsp.rm(tmpDir, { recursive: true });
});

test('workflow arg defaults resolve ${config:KEY}', async () => {
  const workflow = {
    name: 'config-arg-default',
    args: {
      cluster: { default: '${config:default_cluster}' },
    },
    steps: [
      {
        id: 'echo',
        command: 'node -e "process.stdout.write(process.argv[1])" -- "${cluster}"',
      },
    ],
  };

  const { tmpDir, stateDir, filePath } = await setupWorkflow(workflow);
  const globalsPath = await setupGlobals(tmpDir, { default_cluster: 'prod-us-east' });

  const env = { ...process.env, LOBSTER_STATE_DIR: stateDir, LOBSTER_GLOBALS_FILE: globalsPath };

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
  assert.deepEqual(result.output, ['prod-us-east']);
  await fsp.rm(tmpDir, { recursive: true });
});

test('workflow works normally when no globals file exists', async () => {
  const workflow = {
    name: 'no-globals',
    steps: [
      {
        id: 'echo',
        command: 'node -e "process.stdout.write(\'ok\')"',
      },
    ],
  };

  const { tmpDir, stateDir, filePath } = await setupWorkflow(workflow);

  const env = {
    ...process.env,
    LOBSTER_STATE_DIR: stateDir,
    LOBSTER_GLOBALS_FILE: path.join(tmpDir, 'nonexistent-globals.json'),
  };

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
  assert.deepEqual(result.output, ['ok']);
  await fsp.rm(tmpDir, { recursive: true });
});
