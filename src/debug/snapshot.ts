import { promises as fsp } from 'node:fs';
import path from 'node:path';

import type { DebugSnapshot } from '../workflows/file.js';

const DEBUG_DIR = '.lobster-debug';

export async function writeDebugSnapshot(
  snapshot: DebugSnapshot,
  cwd: string,
): Promise<string> {
  const dir = path.join(cwd, DEBUG_DIR);
  await fsp.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${snapshot.runId}.json`);
  await fsp.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
  return filePath;
}

export async function readDebugSnapshot(filePath: string): Promise<DebugSnapshot> {
  const raw = await fsp.readFile(filePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid debug snapshot file: ${filePath} (not valid JSON)`);
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('runId' in parsed) ||
    !('steps' in parsed) ||
    !('args' in parsed) ||
    !('status' in parsed)
  ) {
    throw new Error(`Invalid debug snapshot file: ${filePath} (missing required fields)`);
  }
  return parsed as DebugSnapshot;
}
