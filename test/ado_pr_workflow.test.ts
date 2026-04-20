import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDefaultRegistry } from '../src/commands/registry.js';
import { runWorkflowFile } from '../src/workflows/file.js';

// Simulated ADO PR data — mimics `az repos pr list` output
const MOCK_PRS = [
  {
    pullRequestId: 101,
    title: 'Fix auth bug',
    url: 'https://dev.azure.com/org/proj/_git/repo/pullrequest/101',
    creationDate: new Date(Date.now() - 2 * 86400000).toISOString(), // 2 days ago
    createdBy: { displayName: 'Alice' },
    reviewers: [
      { displayName: 'Bob', vote: 0 },
      { displayName: 'Carol', vote: 0 },
    ],
  },
  {
    pullRequestId: 102,
    title: 'Add logging',
    url: 'https://dev.azure.com/org/proj/_git/repo/pullrequest/102',
    creationDate: new Date(Date.now() - 5 * 86400000).toISOString(), // 5 days ago
    createdBy: { displayName: 'Alice' },
    reviewers: [
      { displayName: 'Bob', vote: 10 },
      { displayName: 'Carol', vote: 0 },
    ],
  },
  {
    pullRequestId: 103,
    title: 'Old refactor',
    url: 'https://dev.azure.com/org/proj/_git/repo/pullrequest/103',
    creationDate: new Date(Date.now() - 45 * 86400000).toISOString(), // 45 days ago — older than 30d
    createdBy: { displayName: 'Alice' },
    reviewers: [
      { displayName: 'Dave', vote: 0 },
    ],
  },
  {
    pullRequestId: 104,
    title: 'No reviewers yet',
    url: 'https://dev.azure.com/org/proj/_git/repo/pullrequest/104',
    creationDate: new Date(Date.now() - 1 * 86400000).toISOString(), // 1 day ago
    createdBy: { displayName: 'Alice' },
    reviewers: [],
  },
];

async function runAdoWorkflow() {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lobster-ado-pr-'));
  const stateDir = path.join(tmpDir, 'state');
  const filePath = path.join(tmpDir, 'workflow.lobster');
  const dataFile = path.join(tmpDir, 'prs.json');
  await fsp.writeFile(dataFile, JSON.stringify(MOCK_PRS), 'utf8');

  // Build a workflow that reads mock data from a file instead of calling az repos pr list
  const workflow = {
    name: 'ado-pr-review-notify-test',
    args: { org: { description: 'org' }, project: { description: 'project' } },
    steps: [
      {
        id: 'fetch',
        run: `cat ${dataFile}`,
      },
      {
        id: 'check',
        for_each: '$fetch.json',
        steps: [
          {
            id: 'enrich',
            pipeline: "compute recent='days_since(creationDate) < 30' unreviewed='length(reviewers) == 0 || every(reviewers, @.vote == 0)' reviewer_count='length(reviewers)' approved_count='count(reviewers, @.vote > 0)'",
            stdin: '$item.json',
          },
          {
            id: 'diff',
            pipeline: 'diff.last --key ado-pr-review:testorg/testproj#$item.json.pullRequestId',
            stdin: '$enrich.json',
            when: '$enrich.json.recent == true && $enrich.json.unreviewed == true',
          },
        ],
      },
    ],
  };

  await fsp.writeFile(filePath, JSON.stringify(workflow, null, 2), 'utf8');

  const result = await runWorkflowFile({
    filePath,
    ctx: {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      env: { ...process.env, LOBSTER_STATE_DIR: stateDir },
      mode: 'tool',
      registry: createDefaultRegistry(),
    },
    args: { org: 'testorg', project: 'testproj' },
  });

  return { result, stateDir, tmpDir };
}

test('ado-pr-review workflow: enriches PRs and filters correctly', async () => {
  const { result } = await runAdoWorkflow();

  assert.equal(result.status, 'ok');
  const output = result.output as any[];

  // We should have 4 iterations (one per PR)
  assert.equal(output.length, 4);

  // PR 101: recent + unreviewed → enrich + diff both run
  const pr101 = output[0];
  assert.equal(pr101.index, 0);
  assert.ok(pr101.enrich, 'PR 101 should have enrich result');
  assert.equal(pr101.enrich.recent, true);
  assert.equal(pr101.enrich.unreviewed, true);
  assert.equal(pr101.enrich.reviewer_count, 2);
  assert.equal(pr101.enrich.approved_count, 0);
  assert.ok(pr101.diff, 'PR 101 should have diff result (unreviewed + recent)');
  assert.equal(pr101.diff.changed, true); // first run, always changed

  // PR 102: recent but NOT unreviewed (Bob voted 10) → diff skipped
  const pr102 = output[1];
  assert.equal(pr102.enrich.recent, true);
  assert.equal(pr102.enrich.unreviewed, false);
  assert.equal(pr102.enrich.approved_count, 1);
  assert.equal(pr102.diff, undefined); // condition was false

  // PR 103: older than 30 days → recent is false → diff skipped
  const pr103 = output[2];
  assert.equal(pr103.enrich.recent, false);
  assert.equal(pr103.enrich.unreviewed, true);
  assert.equal(pr103.diff, undefined);

  // PR 104: recent + no reviewers = unreviewed → diff runs
  const pr104 = output[3];
  assert.equal(pr104.enrich.recent, true);
  assert.equal(pr104.enrich.unreviewed, true);
  assert.equal(pr104.enrich.reviewer_count, 0);
  assert.ok(pr104.diff, 'PR 104 should have diff result');
});

test('ado-pr-review workflow: second run detects no changes', async () => {
  // Run twice with same state dir to verify diff.last tracks state
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lobster-ado-pr2-'));
  const stateDir = path.join(tmpDir, 'state');
  const filePath = path.join(tmpDir, 'workflow.lobster');
  const dataFile = path.join(tmpDir, 'prs.json');
  await fsp.writeFile(dataFile, JSON.stringify([MOCK_PRS[0]]), 'utf8');

  const workflow = {
    name: 'ado-pr-rerun',
    steps: [
      { id: 'fetch', run: `cat ${dataFile}` },
      {
        id: 'check',
        for_each: '$fetch.json',
        steps: [
          {
            id: 'enrich',
            pipeline: "compute recent='days_since(creationDate) < 30' unreviewed='length(reviewers) == 0 || every(reviewers, @.vote == 0)' reviewer_count='length(reviewers)' approved_count='count(reviewers, @.vote > 0)'",
            stdin: '$item.json',
          },
          {
            id: 'diff',
            pipeline: 'diff.last --key ado-pr-rerun-101',
            stdin: '$enrich.json',
            when: '$enrich.json.recent == true && $enrich.json.unreviewed == true',
          },
        ],
      },
    ],
  };

  await fsp.writeFile(filePath, JSON.stringify(workflow, null, 2), 'utf8');

  const ctx = {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: { ...process.env, LOBSTER_STATE_DIR: stateDir },
    mode: 'tool' as const,
    registry: createDefaultRegistry(),
  };

  // First run — should be changed
  const run1 = await runWorkflowFile({ filePath, ctx });
  const out1 = run1.output as any[];
  assert.equal(out1[0].diff.changed, true);

  // Second run with same data — should be unchanged
  const run2 = await runWorkflowFile({ filePath, ctx });
  const out2 = run2.output as any[];
  assert.equal(out2[0].diff.changed, false);
});
