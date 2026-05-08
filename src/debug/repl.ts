import * as readline from 'node:readline';

import type { DebugSnapshot, WorkflowStepResult } from '../workflows/file.js';
import { parseStepRef, getStepRefValue } from '../workflows/file.js';

function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function stepSummary(id: string, result: WorkflowStepResult): string {
  if (result.error) return `${id} — error: ${result.errorMessage ?? 'unknown'}`;
  if (result.skipped) return `${id} — skipped`;
  if (result.approved === true) return `${id} — approved`;
  if (result.approved === false) return `${id} — rejected`;
  return `${id} — ok`;
}

export function evaluateExpression(
  input: string,
  snapshot: DebugSnapshot,
): { output: string } | { error: string } | { exit: true } {
  const trimmed = input.trim();
  if (!trimmed) return { output: '' };

  if (trimmed === '.exit' || trimmed === '.quit') {
    return { exit: true };
  }

  if (trimmed === '.steps') {
    const lines = Object.entries(snapshot.steps).map(
      ([id, result]) => stepSummary(id, result),
    );
    return { output: lines.length ? lines.join('\n') : '(no steps)' };
  }

  if (trimmed === '.args') {
    return { output: formatValue(snapshot.args) };
  }

  if (trimmed === '.env') {
    return { output: formatValue(snapshot.env) };
  }

  if (trimmed === '.help') {
    return {
      output: [
        'Debug REPL commands:',
        '  $step.field        — inspect step result (e.g. $fetch.stdout, $parse.json.items)',
        '  $step              — full step result object',
        '  ${argName}         — workflow argument value',
        '  ${env:VAR}         — workflow environment variable',
        '  .steps             — list all steps and their statuses',
        '  .args              — dump all resolved args',
        '  .env               — dump workflow env',
        '  .help              — show this help',
        '  .exit / .quit      — exit the REPL',
      ].join('\n'),
    };
  }

  // ${env:VAR} — env variable
  const envMatch = trimmed.match(/^\$\{env:([A-Za-z0-9_-]+)\}$/);
  if (envMatch) {
    const key = envMatch[1];
    if (key in snapshot.env) {
      return { output: snapshot.env[key] };
    }
    return { error: `Environment variable not found: ${key}` };
  }

  // ${argName} — arg value
  const argMatch = trimmed.match(/^\$\{([A-Za-z0-9_-]+)\}$/);
  if (argMatch) {
    const key = argMatch[1];
    if (key in snapshot.args) {
      return { output: formatValue(snapshot.args[key]) };
    }
    return { error: `Argument not found: ${key}` };
  }

  // $stepId.field — step ref
  const ref = parseStepRef(trimmed);
  if (ref) {
    try {
      const value = getStepRefValue(ref, snapshot.steps, true);
      return { output: formatValue(value) };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  // $stepId (bare) — full step result
  const bareMatch = trimmed.match(/^\$([A-Za-z0-9_-]+)$/);
  if (bareMatch) {
    const id = bareMatch[1];
    if (id in snapshot.steps) {
      return { output: formatValue(snapshot.steps[id]) };
    }
    return { error: `Unknown step: ${id}` };
  }

  return { error: `Unrecognized expression: ${trimmed}. Type .help for usage.` };
}

export async function startDebugRepl(
  snapshot: DebugSnapshot,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<void> {
  const rl = readline.createInterface({
    input: input as any,
    output: output as any,
    prompt: 'debug> ',
    terminal: true,
  });

  // Ensure terminal cursor is visible (may be hidden by TUI frameworks)
  output.write('\x1B[?25h');
  output.write(`\nDebug session for workflow: ${snapshot.workflowName ?? snapshot.workflowFile}\n`);
  output.write(`Run ID: ${snapshot.runId} | Status: ${snapshot.status} | ${Object.keys(snapshot.steps).length} step(s)\n`);
  output.write('Type .help for available commands, .exit to quit.\n\n');

  rl.prompt();

  return new Promise<void>((resolve) => {
    rl.on('line', (line) => {
      const result = evaluateExpression(line, snapshot);
      if ('exit' in result) {
        rl.close();
        return;
      }
      if ('error' in result) {
        output.write(`Error: ${result.error}\n`);
      } else if (result.output) {
        output.write(`${result.output}\n`);
      }
      rl.prompt();
    });

    rl.on('close', () => {
      resolve();
    });
  });
}
