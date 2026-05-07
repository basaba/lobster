function isWhitespace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function splitPipes(input) {
  const parts = [];
  let current = '';
  let quote = null;
  let parenDepth = 0;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (quote) {
      if (ch === '\\') {
        const next = input[i + 1];
        if (next) {
          current += ch + next;
          i++;
          continue;
        }
      }
      current += ch;
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === '(' && !quote) {
      parenDepth++;
      current += ch;
      continue;
    }
    if (ch === ')' && !quote) {
      parenDepth--;
      current += ch;
      continue;
    }

    if (ch === '|' && parenDepth === 0) {
      // Skip || (logical OR) — not a pipe separator
      if (input[i + 1] === '|') {
        current += '||';
        i++;
        continue;
      }
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  if (quote) throw new Error('Unclosed quote');
  if (current.trim().length > 0) parts.push(current.trim());
  return parts;
}

function tokenizeCommand(input) {
  const tokens = [];
  let current = '';
  let quote = null;
  let parenDepth = 0;

  const push = () => {
    if (current.length > 0) tokens.push(current);
    current = '';
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    // Inside parenthesized group — collect everything until matching close
    if (parenDepth > 0) {
      if (ch === '(') {
        parenDepth++;
        current += ch;
      } else if (ch === ')') {
        parenDepth--;
        if (parenDepth === 0) {
          // End of paren group — don't include the closing paren
          continue;
        }
        current += ch;
      } else {
        current += ch;
      }
      continue;
    }

    if (quote) {
      if (quote === "'") {
        if (ch === '\\' && input[i + 1] === quote) {
          current += quote;
          i++;
          continue;
        }
        if (ch === quote) {
          quote = null;
          continue;
        }
        current += ch;
        continue;
      }

      // Double-quoted mode: preserve unknown escapes (\n, \t, etc) while
      // unescaping only shell-like quote/backslash escapes.
      if (ch === '\\') {
        const next = input[i + 1];
        if (next === '"' || next === '\\' || next === '$' || next === '`') {
          current += next;
          i++;
          continue;
        }
        if (next === '\n') {
          i++;
          continue;
        }
        current += ch;
        continue;
      }

      if (ch === quote) {
        quote = null;
        continue;
      }

      current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    // Open paren at token boundary starts a grouped expression
    if (ch === '(' && current.length === 0) {
      parenDepth = 1;
      continue;
    }

    if (isWhitespace(ch)) {
      push();
      continue;
    }

    current += ch;
  }

  if (quote) throw new Error('Unclosed quote');
  if (parenDepth > 0) throw new Error('Unclosed parenthesis');
  push();
  return tokens;
}

function parseArgs(tokens) {
  const args = { _: [] };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=');
      if (eq !== -1) {
        const key = tok.slice(2, eq);
        const value = tok.slice(eq + 1);
        args[key] = value;
        continue;
      }

      const key = tok.slice(2);
      const next = tokens[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
        continue;
      }
      args[key] = next;
      i++;
      continue;
    }

    args._.push(tok);
  }

  return args;
}

export function parsePipeline(input) {
  const stages = splitPipes(input);
  if (stages.length === 0) throw new Error('Empty pipeline');

  return stages.map((stage) => {
    const tokens = tokenizeCommand(stage);
    if (tokens.length === 0) throw new Error('Empty command stage');
    const name = tokens[0];
    const args = parseArgs(tokens.slice(1));
    return { name, args, raw: stage };
  });
}
