import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { loadGlobals, defaultGlobalsPath } from '../src/config/globals.js';

test('loadGlobals returns empty object when file does not exist', () => {
  const result = loadGlobals({ LOBSTER_GLOBALS_FILE: '/tmp/nonexistent-globals-12345.json' });
  assert.deepEqual(result, {});
});

test('loadGlobals reads valid globals file', async () => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lobster-globals-'));
  const filePath = path.join(tmpDir, 'globals.json');
  await fsp.writeFile(filePath, JSON.stringify({ cluster: 'mycluster', team: 'myteam' }), 'utf8');

  const result = loadGlobals({ LOBSTER_GLOBALS_FILE: filePath });
  assert.deepEqual(result, { cluster: 'mycluster', team: 'myteam' });

  await fsp.rm(tmpDir, { recursive: true });
});

test('loadGlobals returns empty object for empty file', async () => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lobster-globals-'));
  const filePath = path.join(tmpDir, 'globals.json');
  await fsp.writeFile(filePath, '', 'utf8');

  const result = loadGlobals({ LOBSTER_GLOBALS_FILE: filePath });
  assert.deepEqual(result, {});

  await fsp.rm(tmpDir, { recursive: true });
});

test('loadGlobals throws on invalid JSON', async () => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lobster-globals-'));
  const filePath = path.join(tmpDir, 'globals.json');
  await fsp.writeFile(filePath, '{ invalid json }', 'utf8');

  assert.throws(
    () => loadGlobals({ LOBSTER_GLOBALS_FILE: filePath }),
    /Invalid JSON in globals file/,
  );

  await fsp.rm(tmpDir, { recursive: true });
});

test('loadGlobals throws on non-object JSON (array)', async () => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lobster-globals-'));
  const filePath = path.join(tmpDir, 'globals.json');
  await fsp.writeFile(filePath, '["a", "b"]', 'utf8');

  assert.throws(
    () => loadGlobals({ LOBSTER_GLOBALS_FILE: filePath }),
    /must be a JSON object/,
  );

  await fsp.rm(tmpDir, { recursive: true });
});

test('loadGlobals throws on non-string values', async () => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lobster-globals-'));
  const filePath = path.join(tmpDir, 'globals.json');
  await fsp.writeFile(filePath, JSON.stringify({ ok: 'fine', bad: 42 }), 'utf8');

  assert.throws(
    () => loadGlobals({ LOBSTER_GLOBALS_FILE: filePath }),
    /must be a string/,
  );

  await fsp.rm(tmpDir, { recursive: true });
});

test('loadGlobals respects LOBSTER_GLOBALS_FILE env override', async () => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lobster-globals-'));
  const filePath = path.join(tmpDir, 'custom-globals.json');
  await fsp.writeFile(filePath, JSON.stringify({ region: 'us-west' }), 'utf8');

  const result = loadGlobals({ LOBSTER_GLOBALS_FILE: filePath });
  assert.deepEqual(result, { region: 'us-west' });

  await fsp.rm(tmpDir, { recursive: true });
});

test('defaultGlobalsPath uses LOBSTER_GLOBALS_FILE when set', () => {
  const result = defaultGlobalsPath({ LOBSTER_GLOBALS_FILE: '/custom/path/globals.json' });
  assert.equal(result, '/custom/path/globals.json');
});

test('defaultGlobalsPath falls back to ~/.lobster/globals.json', () => {
  const result = defaultGlobalsPath({});
  assert.equal(result, path.join(os.homedir(), '.lobster', 'globals.json'));
});
