import test from 'node:test';
import assert from 'node:assert/strict';
import { Lobster, exec } from '../src/sdk/index.js';

test('Lobster emits run:start and run:complete events', async () => {
  const events: any[] = [];
  const wf = new Lobster();
  wf.pipe((items) => items.map((i) => ({ ...i, doubled: true })));

  wf.on('run:start', (e) => events.push({ type: 'run:start', ...e }));
  wf.on('run:complete', (e) => events.push({ type: 'run:complete', ...e }));

  const result = await wf.run([{ val: 1 }]);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'ok');

  assert.equal(events.length, 2);
  assert.equal(events[0].type, 'run:start');
  assert.ok(events[0].runId);
  assert.equal(events[0].stages, 1);

  assert.equal(events[1].type, 'run:complete');
  assert.equal(events[1].status, 'ok');
  assert.equal(events[1].runId, events[0].runId);
  assert.ok(typeof events[1].durationMs === 'number');
});

test('Lobster emits step:start and step:complete for each stage', async () => {
  const events: any[] = [];
  const wf = new Lobster();
  wf.pipe((items) => items);
  wf.pipe((items) => items);
  wf.pipe((items) => items);

  wf.on('step:start', (e) => events.push({ type: 'step:start', ...e }));
  wf.on('step:complete', (e) => events.push({ type: 'step:complete', ...e }));

  await wf.run([{ x: 1 }]);

  // 3 stages → 3 start + 3 complete = 6 step events
  assert.equal(events.length, 6);

  // Verify order: start-0, complete-0, start-1, complete-1, start-2, complete-2
  assert.equal(events[0].type, 'step:start');
  assert.equal(events[0].index, 0);
  assert.equal(events[1].type, 'step:complete');
  assert.equal(events[1].index, 0);
  assert.equal(events[1].status, 'ok');

  assert.equal(events[2].type, 'step:start');
  assert.equal(events[2].index, 1);
  assert.equal(events[3].type, 'step:complete');
  assert.equal(events[3].index, 1);

  assert.equal(events[4].type, 'step:start');
  assert.equal(events[4].index, 2);
  assert.equal(events[5].type, 'step:complete');
  assert.equal(events[5].index, 2);
});

test('run:complete includes error on failure', async () => {
  const events: any[] = [];
  const wf = new Lobster();
  wf.pipe(() => { throw new Error('stage boom'); });

  wf.on('run:complete', (e) => events.push(e));

  const result = await wf.run([]);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'error');

  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'error');
  assert.equal(events[0].error.message, 'stage boom');
});

test('runId is consistent across all events in a run', async () => {
  const runIds = new Set<string>();
  const wf = new Lobster();
  wf.pipe((items) => items);
  wf.pipe((items) => items);

  wf.on('run:start', (e) => runIds.add(e.runId));
  wf.on('step:start', (e) => runIds.add(e.runId));
  wf.on('step:complete', (e) => runIds.add(e.runId));
  wf.on('run:complete', (e) => runIds.add(e.runId));

  const result = await wf.run([]);
  // All events share the same runId
  assert.equal(runIds.size, 1);
  // And it matches the result
  assert.ok(runIds.has(result.runId));
});

test('no crash when no event listeners are attached', async () => {
  const wf = new Lobster();
  wf.pipe((items) => items);

  const result = await wf.run([{ a: 1 }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.output, [{ a: 1 }]);
});

test('result includes runId', async () => {
  const wf = new Lobster();
  wf.pipe((items) => items);

  const result = await wf.run([]);
  assert.ok(result.runId);
  assert.ok(typeof result.runId === 'string');
  assert.ok(result.runId.length > 0);
});

test('resume emits events', async () => {
  const { approve } = await import('../src/sdk/index.js');
  const events: any[] = [];
  const wf = new Lobster();
  wf.pipe((items) => items);
  wf.pipe(approve({ prompt: 'ok?' }));
  wf.pipe((items) => items.map((i) => ({ ...i, approved: true })));

  const first = await wf.run([{ id: 1 }]);
  assert.equal(first.status, 'needs_approval');

  wf.on('run:start', (e) => events.push({ type: 'run:start', ...e }));
  wf.on('step:complete', (e) => events.push({ type: 'step:complete', ...e }));
  wf.on('run:complete', (e) => events.push({ type: 'run:complete', ...e }));

  const resumed = await wf.resume(first.requiresApproval.resumeToken, { approved: true });
  assert.equal(resumed.status, 'ok');

  // Should have run:start, step events, run:complete
  const starts = events.filter((e) => e.type === 'run:start');
  const completes = events.filter((e) => e.type === 'run:complete');
  assert.equal(starts.length, 1);
  assert.equal(completes.length, 1);
  assert.equal(completes[0].status, 'ok');
});
