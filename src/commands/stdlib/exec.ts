import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveInlineShellCommand } from '../../shell.js';

export const execCommand = {
  name: 'exec',
  meta: {
    description: 'Run an OS command',
    argsSchema: {
      type: 'object',
      properties: {
        json: { type: 'boolean', description: 'Parse stdout as JSON (single value).' },
        shell: { type: 'string', description: 'Run via the system shell with this command line.' },
        stdin: { type: 'string', enum: ['raw', 'json', 'jsonl'], description: 'Pipe pipeline input to command stdin.' },
        'stdin-file': { type: 'string', enum: ['raw', 'json', 'jsonl'], description: 'Write pipeline input to a temp file; sets LOBSTER_STDIN_FILE env var.' },
        _: { type: 'array', items: { type: 'string' }, description: 'Command + args.' },
      },
      required: ['_'],
    },
    sideEffects: ['local_exec'],
  },
  help() {
    return `exec — run an OS command\n\n` +
      `Usage:\n` +
      `  exec <command...>\n` +
      `  exec --stdin raw|json|jsonl <command...>\n` +
      `  exec --stdin-file raw|json|jsonl <command...>\n` +
      `  exec --json <command...>\n` +
      `  exec --shell "<command line>"\n\n` +
      `Notes:\n` +
      `  - With --json, parses stdout as JSON (single value).\n` +
      `  - With --stdin, writes pipeline input to stdin.\n` +
      `  - With --stdin-file, writes pipeline input to a temp file and sets LOBSTER_STDIN_FILE.\n` +
      `  - --stdin and --stdin-file are mutually exclusive.\n` +
      `  - With --shell (or a single arg containing spaces), runs via the system shell.\n`;
  },
  async run({ input, args, ctx }) {
    const cmd = args._;
    const cwd = ctx?.cwd ?? process.cwd();

    const shellLine = typeof args.shell === 'string' ? args.shell : null;
    const useShell = Boolean(args.shell) || (cmd.length === 1 && /\s/.test(cmd[0]));
    const stdinMode = typeof args.stdin === 'string' ? String(args.stdin).toLowerCase() : null;
    const stdinFileMode = typeof args['stdin-file'] === 'string' ? String(args['stdin-file']).toLowerCase() : null;

    if (!cmd.length && !shellLine) throw new Error('exec requires a command');
    if (stdinMode && stdinFileMode) throw new Error('exec: --stdin and --stdin-file are mutually exclusive');

    let stdinPayload = null;
    let tmpDir = null;
    let tmpFile = null;

    try {
      if (stdinFileMode) {
        tmpDir = mkdtempSync(join(tmpdir(), 'lobster-stdin-'));
        const ext = stdinFileMode === 'json' ? '.json' : '.txt';
        tmpFile = join(tmpDir, `input${ext}`);
        await writeStdinFile(input, stdinFileMode, tmpFile);
      } else if (stdinMode) {
        const items = [];
        for await (const item of input) items.push(item);
        stdinPayload = encodeStdin(items, stdinMode);
      } else {
        for await (const _item of input) {
          // no-op drain
        }
      }

      const execEnv = tmpFile ? { ...ctx.env, LOBSTER_STDIN_FILE: tmpFile } : ctx.env;

      const result = useShell
        ? await runShellLine(shellLine ?? cmd[0] ?? '', { env: execEnv, cwd, stdin: stdinPayload, signal: ctx.signal })
        : await runProcess(cmd[0], cmd.slice(1), { env: execEnv, cwd, stdin: stdinPayload, signal: ctx.signal });

      if (args.json) {
        let parsed;
        try {
          parsed = JSON.parse(result.stdout.trim() || 'null');
        } catch (err) {
          throw new Error(`exec --json could not parse stdout as JSON: ${err?.message ?? String(err)}`);
        }

        return {
          output: asStream(Array.isArray(parsed) ? parsed : [parsed]),
        };
      }

      const lines = result.stdout.split(/\r?\n/).filter(Boolean);
      return { output: asStream(lines) };
    } finally {
      if (tmpFile) {
        try { unlinkSync(tmpFile); } catch {}
        try { rmdirSync(tmpDir!); } catch {}
      }
    }
  },
};

function runProcess(command, argv, { env, cwd, stdin, signal }) {
  return new Promise<any>((resolve, reject) => {
    const child = spawn(command, argv, {
      env,
      cwd,
      signal,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    if (typeof stdin === 'string') {
      child.stdin.setDefaultEncoding('utf8');
      child.stdin.write(stdin);
    }
    child.stdin.end();

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`exec failed (${code}): ${stderr.trim() || stdout.trim() || command}`));
    });
  });
}

function runShellLine(commandLine, { env, cwd, stdin, signal }) {
  const shell = resolveInlineShellCommand({ command: commandLine, env });
  return runProcess(shell.command, shell.argv, { env, cwd, stdin, signal });
}

function encodeStdin(items, mode) {
  if (mode === 'json') return JSON.stringify(items);
  if (mode === 'jsonl') {
    return items.map((item) => JSON.stringify(item)).join('\n') + (items.length ? '\n' : '');
  }
  if (mode === 'raw') {
    return items.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join('\n');
  }
  throw new Error(`exec --stdin must be raw, json, or jsonl (got ${mode})`);
}

async function writeStdinFile(input, mode, filePath) {
  if (mode !== 'raw' && mode !== 'json' && mode !== 'jsonl') {
    throw new Error(`exec --stdin-file must be raw, json, or jsonl (got ${mode})`);
  }

  const ws = createWriteStream(filePath, { mode: 0o600 });
  try {
    let first = true;
    if (mode === 'json') ws.write('[');

    for await (const item of input) {
      if (mode === 'json') {
        ws.write(first ? '' : ',');
        ws.write(JSON.stringify(item));
      } else if (mode === 'jsonl') {
        ws.write(JSON.stringify(item) + '\n');
      } else {
        if (!first) ws.write('\n');
        ws.write(typeof item === 'string' ? item : JSON.stringify(item));
      }
      first = false;
    }

    if (mode === 'json') ws.write(']');
  } finally {
    await new Promise<void>((resolve, reject) => {
      ws.end(() => resolve());
      ws.on('error', reject);
    });
  }
}

async function* asStream(items) {
  for (const item of items) yield item;
}
