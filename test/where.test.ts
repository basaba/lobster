import test from 'node:test';
import assert from 'node:assert/strict';

import { runPipeline } from '../src/runtime.js';
import { createDefaultRegistry } from '../src/commands/registry.js';
import { parsePipeline } from '../src/parser.js';

async function run(pipelineText: string, input: any[]) {
  const pipeline = parsePipeline(pipelineText);
  const registry = createDefaultRegistry();
  const res = await runPipeline({
    pipeline,
    registry,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    mode: 'tool',
    input: (async function* () { for (const x of input) yield x; })(),
  });
  return res.items;
}

const items = [
  { status: 'queued', priority: 1, changed: true, isDraft: false },
  { status: 'rejected', priority: 5, changed: false, isDraft: true },
  { status: 'waiting', priority: 3, changed: true, isDraft: false },
  { status: 'approved', priority: 2, changed: false, isDraft: false },
];

// ── Backward compatibility ──

test('where: simple equality with ==', async () => {
  const out = await run("where status==queued", items);
  assert.equal(out.length, 1);
  assert.equal(out[0].status, 'queued');
});

test('where: simple equality with single =', async () => {
  const out = await run("where status=queued", items);
  assert.equal(out.length, 1);
  assert.equal(out[0].status, 'queued');
});

test('where: boolean comparison', async () => {
  const out = await run("where isDraft==false", items);
  assert.equal(out.length, 3);
});

test('where: numeric comparison', async () => {
  const out = await run("where priority>=3", items);
  assert.equal(out.length, 2);
});

test('where: != operator', async () => {
  const out = await run("where status!=queued", items);
  assert.equal(out.length, 3);
});

test('where: quoted string value', async () => {
  const out = await run(`where status=='queued'`, items);
  assert.equal(out.length, 1);
  assert.equal(out[0].status, 'queued');
});

// ── OR expressions ──

test('where: simple || (backward compat)', async () => {
  const out = await run(`where 'status==queued || status==rejected || status==waiting'`, items);
  assert.equal(out.length, 3);
});

// ── AND expressions ──

test('where: && combines predicates', async () => {
  const out = await run(`where 'changed==true && isDraft==false'`, items);
  assert.equal(out.length, 2);
});

// ── Parenthesized expressions (the new capability) ──

test('where: parentheses with || and &&', async () => {
  // (queued OR rejected) AND changed==true → only queued (changed=true)
  const out = await run(`where '(status==queued || status==rejected) && changed==true'`, items);
  assert.equal(out.length, 1);
  assert.equal(out[0].status, 'queued');
});

test('where: parentheses grouping changes precedence', async () => {
  // Without parens: status==approved || (priority>2 && changed==true) → approved + waiting
  const outNoParens = await run(`where 'status==approved || priority>2 && changed==true'`, items);
  assert.equal(outNoParens.length, 2);

  // With parens: (status==approved || priority>2) && changed==true → waiting only
  const outWithParens = await run(`where '(status==approved || priority>2) && changed==true'`, items);
  assert.equal(outWithParens.length, 1);
  assert.equal(outWithParens[0].status, 'waiting');
});

// ── Dotted paths ──

test('where: dotted path on LHS', async () => {
  const data = [
    { sender: { domain: 'example.com' }, ok: true },
    { sender: { domain: 'other.com' }, ok: false },
  ];
  const out = await run(`where sender.domain==example.com`, data);
  assert.equal(out.length, 1);
  assert.equal(out[0].sender.domain, 'example.com');
});

// ── Explicit $ path on RHS for property-to-property comparison ──

test('where: explicit $ path compares properties', async () => {
  const data = [
    { a: 10, b: 10 },
    { a: 10, b: 20 },
  ];
  const out = await run(`where 'a == $.b'`, data);
  assert.equal(out.length, 1);
  assert.equal(out[0].b, 10);
});

// ── Functions ──

test('where: contains() function', async () => {
  const data = [
    { title: 'fix: resolve bug in parser' },
    { title: 'feat: add new command' },
  ];
  const out = await run(`where "contains(title, 'bug')"`, data);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'fix: resolve bug in parser');
});

// ── Equals inside quoted strings should not be normalized ──

test('where: = inside quoted string is preserved', async () => {
  const data = [
    { msg: 'a=b' },
    { msg: 'other' },
  ];
  const out = await run(`where "msg=='a=b'"`, data);
  assert.equal(out.length, 1);
  assert.equal(out[0].msg, 'a=b');
});
