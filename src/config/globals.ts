import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';

/**
 * Default path for the globals config file.
 * Lives alongside the existing ~/.lobster/ directory.
 */
export function defaultGlobalsPath(
  env?: Record<string, string | undefined>,
): string {
  const override = env?.LOBSTER_GLOBALS_FILE ?? process.env.LOBSTER_GLOBALS_FILE;
  if (override && override.trim()) return override.trim();
  return path.join(os.homedir(), '.lobster', 'globals.json');
}

/**
 * Load global key-value config from globals.json.
 * Returns an empty record when the file is missing or empty.
 * Throws on malformed JSON or non-flat values.
 */
export function loadGlobals(
  env?: Record<string, string | undefined>,
): Record<string, string> {
  const filePath = defaultGlobalsPath(env);
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err: any) {
    if (err?.code === 'ENOENT') return {};
    throw err;
  }

  const trimmed = raw.trim();
  if (!trimmed) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`Invalid JSON in globals file: ${filePath}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Globals file must be a JSON object: ${filePath}`);
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      throw new Error(
        `Global "${key}" must be a string, got ${typeof value} in ${filePath}`,
      );
    }
    result[key] = value;
  }
  return result;
}
