import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fsp } from 'node:fs';

import { createDefaultRegistry } from '../src/commands/registry.js';
import { runWorkflowFile } from '../src/workflows/file.js';

async function runWorkflow(workflow: any, args?: Record<string, unknown>) {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lobster-eng-'));
  const filePath = path.join(tmpDir, 'workflow.lobster');
  await fsp.writeFile(filePath, JSON.stringify(workflow, null, 2), 'utf8');

  const result = await runWorkflowFile({
    filePath,
    args,
    ctx: {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: { write: () => {} } as any,
      env: process.env as Record<string, string>,
      mode: 'tool',
      debug: true,
      registry: createDefaultRegistry(),
    },
  });

  await fsp.rm(tmpDir, { recursive: true, force: true });
  return result;
}

// ── emit passthrough ──────────────────────────────────────────────
test('emit with no args passes through input items', async () => {
  const workflow = {
    name: 'emit-passthrough',
    steps: [
      {
        id: 'source',
        run: `node -e "process.stdout.write(JSON.stringify([{a:1},{b:2}]))"`,
      },
      {
        id: 'pass',
        pipeline: 'emit',
        stdin: '$source.json',
      },
    ],
  };

  const result = await runWorkflow(workflow);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.output, [{ a: 1 }, { b: 2 }]);
});

test('emit with no args and no input yields empty', async () => {
  const workflow = {
    name: 'emit-empty',
    steps: [
      {
        id: 'empty',
        pipeline: 'emit',
      },
    ],
  };

  const result = await runWorkflow(workflow);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.output, []);
});

test('emit with args still emits those args (not passthrough)', async () => {
  const workflow = {
    name: 'emit-args',
    steps: [
      {
        id: 'source',
        run: `node -e "process.stdout.write(JSON.stringify([{x:1}]))"`,
      },
      {
        id: 'out',
        pipeline: 'emit hello world',
        stdin: '$source.json',
      },
    ],
  };

  const result = await runWorkflow(workflow);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.output, ['hello', 'world']);
});

// ── ${arg} in when/condition ──────────────────────────────────────
test('condition with ${arg} reference resolves arg value', async () => {
  const workflow = {
    name: 'arg-condition',
    args: {
      mode: { type: 'string', default: 'active' },
    },
    steps: [
      {
        id: 'data',
        run: `node -e "process.stdout.write(JSON.stringify({v:1}))"`,
      },
      {
        id: 'guarded',
        run: `node -e "process.stdout.write(JSON.stringify({ok:true}))"`,
        when: '${mode} == active',
      },
    ],
  };

  const result = await runWorkflow(workflow);
  assert.equal(result.status, 'ok');
  assert.ok(result._debug);
  assert.ok(!result._debug!.steps.guarded.skipped, 'step should NOT be skipped when arg matches');
});

test('condition with ${arg} skips when arg does not match', async () => {
  const workflow = {
    name: 'arg-condition-skip',
    args: {
      mode: { type: 'string', default: 'inactive' },
    },
    steps: [
      {
        id: 'data',
        run: `node -e "process.stdout.write(JSON.stringify({v:1}))"`,
      },
      {
        id: 'guarded',
        run: `node -e "process.stdout.write(JSON.stringify({ok:true}))"`,
        when: '${mode} == active',
      },
    ],
  };

  const result = await runWorkflow(workflow);
  assert.equal(result.status, 'ok');
  assert.ok(result._debug);
  assert.ok(result._debug!.steps.guarded.skipped, 'step should be skipped when arg does not match');
});

test('condition with ${arg} and step ref combined', async () => {
  const workflow = {
    name: 'arg-step-combo',
    args: {
      expected: { type: 'string', default: 'hello' },
    },
    steps: [
      {
        id: 'source',
        run: `node -e "process.stdout.write(JSON.stringify({msg:'hello'}))"`,
      },
      {
        id: 'check',
        run: `node -e "process.stdout.write(JSON.stringify({matched:true}))"`,
        when: '$source.json.msg == ${expected}',
      },
    ],
  };

  const result = await runWorkflow(workflow);
  assert.equal(result.status, 'ok');
  assert.ok(result._debug);
  assert.ok(!result._debug!.steps.check.skipped, 'step should run when step ref matches arg');
});

test('condition with ${arg} that is undefined skips step', async () => {
  const workflow = {
    name: 'arg-undefined',
    args: {
      flag: { type: 'string' },
    },
    steps: [
      {
        id: 'data',
        run: `node -e "process.stdout.write(JSON.stringify({v:1}))"`,
      },
      {
        id: 'guarded',
        run: `node -e "process.stdout.write(JSON.stringify({ok:true}))"`,
        when: '${flag} == yes',
      },
    ],
  };

  const result = await runWorkflow(workflow);
  assert.equal(result.status, 'ok');
  assert.ok(result._debug);
  assert.ok(result._debug!.steps.guarded.skipped, 'step should be skipped when arg is undefined');
});

test('condition with ${arg} overridden by caller', async () => {
  const workflow = {
    name: 'arg-override',
    args: {
      mode: { type: 'string', default: 'inactive' },
    },
    steps: [
      {
        id: 'data',
        run: `node -e "process.stdout.write(JSON.stringify({v:1}))"`,
      },
      {
        id: 'guarded',
        run: `node -e "process.stdout.write(JSON.stringify({ok:true}))"`,
        when: '${mode} == active',
      },
    ],
  };

  // Pass args that override the default
  const result = await runWorkflow(workflow, { mode: 'active' });
  assert.equal(result.status, 'ok');
  assert.ok(result._debug);
  assert.ok(!result._debug!.steps.guarded.skipped, 'step should run when arg is overridden to match');
});
