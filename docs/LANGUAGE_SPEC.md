# Lobster Language Specification

> **Version:** 1.0 — derived from source (`src/`) as of April 2026  
> **Audience:** AI agents, automation authors, and contributors

Lobster is an OpenClaw-native workflow shell: typed (JSON-first) pipelines, jobs, and approval gates. It is designed for deterministic, resumable automation — not ad-hoc LLM re-planning loops.

---

## Table of Contents

1. [Concepts & Execution Model](#1-concepts--execution-model)
2. [CLI Interface](#2-cli-interface)
3. [Pipeline Syntax](#3-pipeline-syntax)
4. [Expression Language](#4-expression-language)
5. [Template & Interpolation Syntax](#5-template--interpolation-syntax)
6. [Filters](#6-filters)
7. [Built-in Commands (stdlib)](#7-built-in-commands-stdlib)
8. [Workflow Files (`.lobster`)](#8-workflow-files-lobster)
9. [Approval & Input Gates](#9-approval--input-gates)
10. [Resume Flow](#10-resume-flow)
11. [Retry & Error Handling](#11-retry--error-handling)
12. [Environment Variables](#12-environment-variables)
13. [SDK (Programmatic API)](#13-sdk-programmatic-api)
14. [Built-in Workflow Registry](#14-built-in-workflow-registry)

---

## 1. Concepts & Execution Model

### Data Model

- **JSON-first**: all values flowing through pipelines are JSON-serializable (objects, arrays, strings, numbers, booleans, `null`).
- Pipelines operate on **streams of items** — each command receives a stream and yields a stream.
- Loose equality (`==`) is used throughout for convenience (JavaScript semantics).

### Execution Modes

| Mode | Flag | Behavior |
|------|------|----------|
| **human** | `--mode human` (default) | Renderers output to stdout; human-friendly |
| **tool** | `--mode tool` | Single JSON envelope to stdout; machine-readable |

### Pipeline Execution

```
Stage 1  →  Stage 2  →  Stage 3  →  output
  ↑ items flow as async streams between stages
```

Each stage:
1. Receives an input stream (items from previous stage, or initial input).
2. Calls `command.run({ input, args, ctx })`.
3. Produces an output stream for the next stage (or halts the pipeline).

A stage result may set:
- `halt: true` — stops the pipeline (used by `approve`, `diff.gate`).
- `rendered: true` — tells human mode the stage already printed output.

---

## 2. CLI Interface

### Invocation

If `lobster` is not on `PATH`, use `node bin/lobster.js` instead.

```bash
# Direct pipeline execution
lobster '<pipeline>'

# Explicit run subcommand
lobster run [flags] '<pipeline>'
lobster run [flags] --file <workflow.lobster>

# Resume a halted workflow
lobster resume --token <token> --approve yes|no
lobster resume --id <8-hex-id> --approve yes|no
lobster resume --token <token> --response-json '<json>'
lobster resume --id <8-hex-id> --cancel

# Visualize a workflow
lobster graph --file <workflow.lobster> [--format mermaid|dot|ascii]

# Utilities
lobster doctor        # Diagnose installation
lobster version       # Show version
lobster help          # Show help
```

### Run Flags

| Flag | Description |
|------|-------------|
| `--mode human\|tool` | Output mode (default: `human`) |
| `--file <path>` | Load workflow from `.lobster` / `.yaml` / `.json` file |
| `--args-json '<json>'` | Pass JSON object as workflow arguments |
| `--dry-run` | Validate and print execution plan without running |

### Tool-Mode Envelope

All `--mode tool` responses are a single JSON object:

```jsonc
// Success
{
  "protocolVersion": 1,
  "ok": true,
  "status": "ok | needs_approval | needs_input | cancelled",
  "output": [/* items */],
  "requiresApproval": { /* or null */ },
  "requiresInput": { /* or null */ }
}

// Error
{
  "protocolVersion": 1,
  "ok": false,
  "error": { "type": "parse_error | runtime_error", "message": "..." }
}
```

| Status | Meaning | Next Action |
|--------|---------|-------------|
| `ok` | Completed successfully | Read `output` |
| `needs_approval` | Halted at approval gate | `lobster resume --approve yes\|no` |
| `needs_input` | Halted requesting user input | `lobster resume --response-json '...'` |
| `cancelled` | Workflow was cancelled | Done |

---

## 3. Pipeline Syntax

### Structure

Pipelines are composed of **stages** separated by the pipe operator `|`:

```
command1 --flag value positional | command2 arg | command3
```

### Pipe Splitting

- `|` splits stages at the top level.
- `|` inside single or double quotes is **preserved** (not a stage separator).
- Empty stages are an error.

### Argument Parsing

Each stage's text is tokenized into a command name and arguments.

**Named arguments:**
```
--key value       # flag with space-separated value
--key=value       # flag with equals syntax
--key             # boolean flag (set to true)
```

**Positional arguments:**
```
command pos1 pos2   # stored in args._ array
```

Result: `{ _: ["pos1", "pos2"], key: "value", ... }`

### Quoting Rules

**Single-quoted strings** (`'...'`):
- Preserves all content literally.
- Only `\'` is an escape (produces `'`).
- All other backslashes are literal.

```
echo 'a|b'            # → a|b  (pipe not split)
echo 'it\'s here'     # → it's here
```

**Double-quoted strings** (`"..."`):
- Unescapes shell/JSON-like escapes: `\"` → `"`, `\\` → `\`, `\$` → `$`, `` \` `` → `` ` ``.
- `\<newline>` is discarded (line continuation).
- Other backslash sequences (e.g. `\n`, `\t`) are preserved as-is (not interpreted).

```
echo "say \"hello\""      # → say "hello"
echo "{\"key\":\"val\"}"  # → {"key":"val"}
```

**Bare tokens**: sequences of non-whitespace, non-quote characters.

---

## 4. Expression Language

Used by `compute`, `where` (extended mode), and workflow `when`/`condition` fields.

### Literals

| Type | Examples |
|------|----------|
| Number | `42`, `3.14`, `-5` |
| String | `'hello'`, `"world"` |
| Boolean | `true`, `false` |
| Null | `null` |

### Variable References

| Syntax | Meaning |
|--------|---------|
| `foo` | Implicit `$.foo` (current item's field) |
| `$.field.nested` | Explicit root access |
| `@` | Current array element (inside `every`, `some`, `count`) |
| `@.field` | Property of current array element |

### Operators (Precedence High → Low)

| Precedence | Operators | Associativity |
|------------|-----------|---------------|
| 1 | Literals, `()`, function calls, `.` access | — |
| 2 | `!` (NOT), unary `-` | Right |
| 3 | `*`, `/`, `%` | Left |
| 4 | `+`, `-` | Left |
| 5 | `==`, `!=`, `<`, `<=`, `>`, `>=` | Non-associative |
| 6 | `&&` (short-circuit) | Left |
| 7 | `\|\|` (short-circuit) | Left |

### Built-in Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `length(v)` | array/string → number | Array/string length; 0 for other types |
| `every(arr, pred)` | array, predicate → bool | True if all elements satisfy predicate |
| `some(arr, pred)` | array, predicate → bool | True if any element satisfies predicate |
| `count(arr, pred)` | array, predicate → number | Count of elements satisfying predicate |
| `concat(a, b, ...)` | ...any → string | String concatenation |
| `lower(s)` | string → string | Lowercase |
| `upper(s)` | string → string | Uppercase |
| `trim(s)` | string → string | Remove leading/trailing whitespace |
| `contains(s, sub)` | string/array, value → bool | Substring/item containment |
| `starts_with(s, p)` | string, prefix → bool | String starts with prefix |
| `ends_with(s, p)` | string, suffix → bool | String ends with suffix |
| `now()` | — → string | Current time as ISO 8601 |
| `days_since(d)` | date string → number | Days elapsed; `null` if invalid |
| `hours_since(d)` | date string → number | Hours elapsed; `null` if invalid |
| `coalesce(a, b, ...)` | ...any → any | First non-null/non-undefined value |
| `is_null(v)` | any → bool | True if `null` or `undefined` |
| `exists(v)` | any → bool | True if not `undefined` |

**Predicate functions** (`every`, `some`, `count`) use `@` to reference the current element:
```
every(reviewers, @.vote == 0)
count(items, @.priority > 3)
```

### Examples

```
age > 18 && active == true
length(items) > 0
every(votes, @ == 0)
coalesce(nickname, fullName, "Unknown")
days_since(createdAt) < 30
concat(first, " ", last)
```

---

## 5. Template & Interpolation Syntax

Used by `template`, `map`, and workflow field substitution.

### Template Expressions

```
{{fieldName}}                    # property access
{{nested.path}}                  # nested property
{{.}}  or  {{this}}              # entire object
{{value | filter1 | filter2}}    # filter chain
```

- Matched by `{{ expression }}` delimiters.
- Missing paths render as empty string.
- Objects/arrays are JSON-stringified.

### Workflow Argument Interpolation

In workflow files, `${arg_name}` substitutes workflow arguments:

```yaml
run: "git clone https://github.com/${repo}.git -b ${branch}"
```

- Brace-required syntax: `${name}`.
- If arg not found, the literal `${name}` is left as-is.
- Works in: `run`/`command`, `pipeline`, `stdin`, `env`, `cwd`, `workflow` paths.

### Step Reference Substitution

Reference prior step outputs with `$step_id.field`:

```yaml
stdin: $fetch.json                 # strict reference (full value)
run: "echo $fetch.json.count"      # inline interpolation
when: $approval.approved == true   # in conditions
```

| Reference | Resolves To |
|-----------|-------------|
| `$step_id.stdout` | Raw string output |
| `$step_id.json` | Parsed JSON output |
| `$step_id.json.nested.0.field` | Nested path access |
| `$step_id.approved` | Approval result (boolean) |
| `$step_id.response` | Input step response |
| `$step_id.skipped` | Whether step was skipped |

**Resolution order** in a single expression:
1. First pass: resolve `${arg_name}` → arg values.
2. Second pass: resolve `$step_id.field` → step output values.

---

## 6. Filters

Filters transform values inside `{{ }}` template expressions.

### Syntax

```
{{value | filter_name}}
{{value | filter_name arg1 "arg 2"}}
{{value | filter1 | filter2 | filter3}}
```

Filters are applied left-to-right. Arguments are space-separated; use quotes for values containing spaces.

### Built-in Filters

| Filter | Syntax | Description |
|--------|--------|-------------|
| `upper` | `val \| upper` | Uppercase |
| `lower` | `val \| lower` | Lowercase |
| `trim` | `val \| trim` | Strip whitespace |
| `truncate` | `val \| truncate N` | Truncate to N chars (default 80), append `...` |
| `replace` | `val \| replace "from" "to"` | Replace all occurrences |
| `split` | `val \| split sep` | Split string by separator → array |
| `first` | `val \| first` | First element of array |
| `last` | `val \| last` | Last element of array |
| `length` | `val \| length` | Array/string length |
| `join` | `val \| join sep` | Join array (default separator: `", "`) |
| `json` | `val \| json` | JSON stringify (2-space indent) |
| `string` | `val \| string` | Convert to string |
| `default` | `val \| default "fallback"` | Fallback if value is null/empty |
| `round` | `val \| round N` | Round number to N decimal places (default 0) |
| `date` | `val \| date "YYYY-MM-DD HH:mm:ss"` | Format date (default: ISO 8601) |

**Date format tokens:** `YYYY` (year), `MM` (month), `DD` (day), `HH` (hours), `mm` (minutes), `ss` (seconds) — all UTC, zero-padded.

---

## 7. Built-in Commands (stdlib)

### Data Flow Commands

#### `exec` — Run an OS command

```
exec ls -la
exec --shell "echo 'hello world'"
exec --json node -e 'console.log(JSON.stringify({x:1}))'
exec --stdin raw grep pattern
```

| Arg | Type | Description |
|-----|------|-------------|
| `_` (positional) | array | Command + arguments |
| `--shell` | string | Run via system shell |
| `--stdin` | `raw\|json\|jsonl` | How to encode input stream to command stdin |
| `--json` | boolean | Parse stdout as single JSON value |

**Side effects:** `local_exec`

#### `json` — Render output as JSON

```
... | json
```

Renders pipeline items as JSON to stdout. No arguments.

#### `table` — Render output as table

```
... | table
```

Renders objects as columns. Column headers derived from first 20 items.

#### `template` — Render template against each item

```
... | template --text 'PR #{{number}}: {{title | upper}}'
... | template --file ./draft.txt
... | template 'Email from {{from}}: {{subject}}'
```

| Arg | Type | Description |
|-----|------|-------------|
| `--text` | string | Template text |
| `--file` | string | Template file path |
| `_` (positional) | string | Alternate template text |

Supports `{{path}}`, `{{path \| filter}}`, `{{.}}` (whole item).

### Filtering & Selection

#### `where` — Filter by predicate

```
... | where status=active
... | where minutes>=30
... | where sender.domain==example.com
```

Predicate syntax: `field op value`

Operators: `=` (alias for `==`), `==`, `!=`, `<`, `<=`, `>`, `>=`

Value auto-parsing: `true`/`false` → boolean, `null` → null, numeric → number, else string.

#### `pick` — Project fields

```
... | pick id,subject,from
```

Comma-separated list of field names to keep.

#### `head` — Take first N items

```
... | head --n 5
```

Default: 10 items.

#### `dedupe` — Remove duplicates

```
... | dedupe
... | dedupe --key id
```

Stable deduplication (first occurrence kept). Optional `--key` for identity field.

### Transformation

#### `compute` — Add computed properties

```
... | compute unreviewed='every(reviewers, @.vote == 0)'
... | compute age='days_since(createdAt)' active='status == "open"'
```

Adds fields to each item using the [expression language](#4-expression-language).

Syntax: `field='expression'` (positional arguments).

#### `map` — Transform items (wrap/unwrap/add fields)

```
... | map --wrap item           # each item → { item: <original> }
... | map --unwrap data         # each item → item.data
... | map id={{id}} name={{title | upper}}
```

| Arg | Type | Description |
|-----|------|-------------|
| `--wrap` | string | Wrap each item under this key |
| `--unwrap` | string | Extract this field from each item |
| `_` (positional) | assignments | `key={{template}}` pairs |

Cannot use both `--wrap` and `--unwrap`.

#### `sort` — Sort items

```
... | sort --key updatedAt --desc
```

| Arg | Type | Description |
|-----|------|-------------|
| `--key` | string | Dot-path field to sort by |
| `--desc` | boolean | Sort descending |

Stable sort. `null`/`undefined` keys sort last.

#### `groupBy` — Group by key

```
... | groupBy --key status
```

Output: stream of `{ key, items, count }`. Group order is stable (first appearance).

### State Management

#### `state.get` — Read state

```
state.get myKey
```

Returns stored JSON value or null. **Side effects:** `reads_state`.

#### `state.set` — Write state

```
<items> | state.set myKey
```

Stores the input stream as a single JSON value. **Side effects:** `writes_state`.

#### `diff.last` — Compare to previous snapshot

```
<items> | diff.last --key myKey
```

Output: `{ kind: "diff.last", key, changed, before, after }`. **Side effects:** `writes_state`.

#### `diff.gate` — Halt if unchanged

```
<items> | diff.gate --key myKey
```

Like `diff.last`, but **halts the pipeline** if data is unchanged. **Side effects:** `writes_state`.

### Human-in-the-Loop

#### `approve` — Approval gate

```
... | approve --prompt "Send these emails?"
... | approve --emit --preview-from-stdin --limit 5 --prompt "Proceed?"
```

| Arg | Type | Default | Description |
|-----|------|---------|-------------|
| `--prompt` | string | `"Approve?"` | Approval prompt text |
| `--emit` | boolean | false | Force emit mode (halt + return request) |
| `--preview-from-stdin` | boolean | false | Include stdin items in preview |
| `--limit` | number | 5 | Max preview items |

- Interactive mode: prompts on TTY, passes items through if approved.
- Tool/non-interactive mode: emits approval request and halts pipeline.

#### `ask` — Request structured input

```
... | ask --prompt "Review this draft:" --schema '{"type":"object",...}'
```

| Arg | Type | Description |
|-----|------|-------------|
| `--prompt` | string | Question/instruction |
| `--schema` | string | JSON Schema for expected response |
| `--subject-from-stdin` | boolean | Use stdin as context |

### LLM Integration

#### `llm.invoke` — Call an LLM

```
llm.invoke --prompt 'Summarize this' --model claude-3-sonnet
... | llm.invoke --prompt 'Score each item' --output-schema '{"type":"object"}'
```

| Arg | Type | Description |
|-----|------|-------------|
| `--prompt` | string | Primary prompt (required) |
| `--provider` | string | `openclaw`, `pi`, or `http` |
| `--model` | string | Model identifier |
| `--token` | string | Bearer token |
| `--output-schema` | string | JSON Schema for output validation |
| `--max-validation-retries` | number | Retries on schema validation failure |
| `--temperature` | number | Sampling temperature |
| `--max-output-tokens` | number | Max completion tokens |
| `--artifacts-json` | string | JSON array of artifacts |
| `--metadata-json` | string | JSON metadata object |
| `--state-key` | string | Run-state key |
| `--refresh` | boolean | Bypass cache |
| `--disable-cache` | boolean | Skip persistent cache |
| `--schema-version` | string | Logical schema version for caching |

Provider resolution: `--provider` flag → `LOBSTER_LLM_PROVIDER` env → auto-detect (Pi > OpenClaw > HTTP).

**Side effects:** `calls_llm`

#### `llm_task.invoke` — Legacy LLM alias

Backward-compatible alias for `llm.invoke` using the `openclaw` provider. Use `llm.invoke` for new workflows.

### External Integrations

#### `openclaw.invoke` / `clawd.invoke` — Call OpenClaw tool

```
openclaw.invoke --tool message --action send --args-json '{"provider":"telegram"}'
... | openclaw.invoke --tool github --action comment --each --item-key pr
```

| Arg | Type | Description |
|-----|------|-------------|
| `--tool` | string | Tool name (required) |
| `--action` | string | Tool action (required) |
| `--args-json` | string | JSON string of tool arguments |
| `--each` | boolean | Map each pipeline item into tool args |
| `--item-key` | string | Key for pipeline item (default: `"item"`) |
| `--url` | string | OpenClaw URL (or `OPENCLAW_URL` env) |
| `--token` | string | Bearer token (or `OPENCLAW_TOKEN` env) |
| `--dry-run` | boolean | Dry run |
| `--session-key` | string | Session key attribution |

**Side effects:** `calls_clawd_tool`

#### `gog.gmail.search` — Search Gmail

```
gog.gmail.search --query 'newer_than:1d' --max 20
```

Requires the `gog` CLI (`GOG_BIN` env to override). **Side effects:** `reads_email`.

| Arg | Type | Default | Description |
|-----|------|---------|-------------|
| `--query` | string | `"newer_than:1d"` | Gmail search query |
| `--max` | number | 20 | Max results |

#### `gog.gmail.send` — Send Gmail

```
... | approve --prompt 'Send?' | gog.gmail.send
... | gog.gmail.send --dry-run
```

Input: stream of `{ to, subject, body }`. **Side effects:** `sends_email`.

#### `email.triage` — Email triage

```
... | email.triage                                     # deterministic
... | email.triage --llm --model gpt-4 --emit drafts   # LLM-assisted
```

| Arg | Type | Default | Description |
|-----|------|---------|-------------|
| `--limit` | number | 20 | Max items from input |
| `--llm` | boolean | false | Use LLM for categorization |
| `--model` | string | — | Model for LLM |
| `--emit` | string | `"report"` | Output mode: `"report"` or `"drafts"` |

Categories: `needs_reply`, `needs_action`, `fyi`.

---

## 8. Workflow Files (`.lobster`)

Workflow files are YAML (or JSON) documents defining multi-step automation.

### Top-Level Schema

```yaml
name: "My Workflow"                    # optional
description: "What this workflow does" # optional
args:                                  # optional — parameter definitions
  repo:
    description: "GitHub repo"
    default: null                      # omit default → required parameter
  branch:
    description: "Git branch"
    default: "main"
env:                                   # optional — env vars for all steps
  API_KEY: "secret"
  REPO: "${repo}"                      # supports arg interpolation
cwd: "/workspace"                      # optional — working directory
cost_limit:                            # optional — LLM spending control
  max_usd: 10.50
  action: "warn"                       # "warn" or "stop" (default: stop)
steps:                                 # required — non-empty array
  - id: step1
    ...
```

### Step Types

Every step requires a unique `id` and exactly **one** execution mode.

#### Shell Command: `run` / `command`

```yaml
- id: fetch
  run: "curl -s https://api.example.com/data"
  # OR: command: "curl -s ..."
```

Output available as `$fetch.stdout` (raw) and `$fetch.json` (parsed).

#### Pipeline: `pipeline`

```yaml
- id: transform
  pipeline: "compute age='days_since(createdAt)' | where age<30 | pick id,age"
  stdin: $fetch.json
```

#### Nested Workflow: `workflow`

```yaml
- id: sub
  workflow: "./sub-workflow.lobster"
  workflow_args:
    param1: "value"
    param2: $prior.json.key
```

Sub-workflows cannot contain approval/input gates. Circular dependencies are detected.

#### Parallel Execution: `parallel`

```yaml
- id: fetch_all
  parallel:
    wait: "all"          # "all" (default) or "any"
    timeout_ms: 5000     # optional
    branches:
      - id: api_a
        run: "curl https://api-a.com"
      - id: api_b
        run: "curl https://api-b.com"
      - id: api_c
        pipeline: "exec echo '[1,2]' | json"
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `wait` | string | `"all"` | `"all"` or `"any"` |
| `timeout_ms` | number | — | Total timeout for all branches |
| `branches` | array | — | Non-empty array of branch definitions |

- `wait: "all"`: wait for all; fail if any fails.
- `wait: "any"`: return first success; abort others.
- Output: merged object `{ branch_id: result, ... }`.
- Branches support `run`/`command` and `pipeline` only (no nested parallel, loops, approval).

#### Loop: `for_each`

```yaml
- id: process
  for_each: $fetch.json        # must resolve to array
  item_var: "item"             # default: "item"
  index_var: "index"           # default: "index"
  batch_size: 5                # optional: items per batch
  pause_ms: 100                # optional: delay between batches (ms)
  steps:
    - id: transform
      run: "echo Processing item $index"
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `for_each` | string | — | Reference to array (e.g. `$step.json`) |
| `item_var` | string | `"item"` | Variable name for current item |
| `index_var` | string | `"index"` | Variable name for 0-based index |
| `batch_size` | number | 1 | Items per batch |
| `pause_ms` | number | 0 | Delay between batches (ms) |
| `steps` | array | — | Sub-steps (no approval/input/nested loops) |

Inside loop: `$item.json` = current item, `$index.json` = iteration index.
Output: array of objects, one per iteration.

#### Approval Gate

```yaml
- id: deploy_gate
  approval: "Deploy to production?"
```

Or with full configuration — see [Approval & Input Gates](#9-approval--input-gates).

#### Input Request

```yaml
- id: get_config
  input:
    prompt: "Confirm deployment parameters"
    responseSchema: { type: object, properties: { approved: { type: boolean } }, required: [approved] }
    defaults: { approved: false }
```

### Common Step Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | — | **Required.** Unique step identifier |
| `when` / `condition` | string/bool | `true` | Condition to execute |
| `env` | object | `{}` | Step-level environment variables |
| `cwd` | string | inherited | Working directory |
| `stdin` | string/object/null | — | Input data for the step |
| `timeout_ms` | number | — | Max runtime in ms (1–2,147,483,647) |
| `on_error` | string | `"stop"` | `"stop"`, `"continue"`, or `"skip_rest"` |
| `retry` | object | — | Retry configuration |

### Conditional Execution

```yaml
when: true                                          # always run
when: false                                         # always skip
when: $approval.approved == true                    # expression
when: "($a.json.x == 1 || $b.json.y == 2) && $c.json.z > 0"
condition: "$data.json.count > 100"                 # alias for when
```

**Condition expression operators:** `==`, `!=`, `<`, `<=`, `>`, `>=`, `&&`, `||`, `!`, `()`.  
**Operand types:** `$step_id.field` references, string/number/boolean/null literals.

**Skip behavior:** Skipped steps produce `{ id, skipped: true }` with no `stdout`/`json`.

### stdin Resolution

| Pattern | Behavior |
|---------|----------|
| `$step_id.json` | Strict reference — full JSON value from step |
| `$step_id.stdout` | Strict reference — raw string output |
| Any other string | Template with `${arg}` and `$step.field` interpolation |
| Object/array literal | Serialized to JSON |
| `null` | Empty input |

### Step Output Fields

Every completed step produces a result accessible by later steps:

| Field | Type | Description |
|-------|------|-------------|
| `.stdout` | string | Raw output |
| `.json` | any | Parsed JSON (if valid), else `undefined` |
| `.skipped` | boolean | `true` if condition prevented execution |
| `.error` | boolean | `true` if step failed with `on_error: continue` |
| `.errorMessage` | string | Error description |
| `.approved` | boolean | Approval result |
| `.approvedBy` | string | Approver identity |
| `.response` | any | Input step response |
| `.subject` | any | Input step subject data |

---

## 9. Approval & Input Gates

### Approval Configuration

Approval steps pause workflow execution pending human confirmation.

**Simple forms:**
```yaml
approval: true                    # default prompt
approval: "Deploy to production?" # custom prompt
```

**Full configuration:**
```yaml
approval:
  prompt: "Deploy to production?"
  items: [{ data: "context" }]     # optional context items
  preview: "Deploying v1.2.3"      # optional preview text
  initiated_by: "${user_id}"       # who triggered the workflow
  required_approver: "ops-lead"    # restrict to specific approver
  require_different_approver: true # approver ≠ initiator
```

### Input Configuration

```yaml
input:
  prompt: "Review and confirm"
  responseSchema:                  # JSON Schema (required)
    type: object
    properties:
      approved: { type: boolean }
    required: [approved]
  defaults:                        # optional defaults
    approved: false
```

### Constraints

- Approval/input steps **cannot** be inside `for_each` loops.
- Cannot combine `approval` + `input` on the same step.
- Sub-workflows cannot contain approval/input gates.
- In non-interactive/tool mode, these steps halt and return a resume token.

---

## 10. Resume Flow

When a workflow halts at an approval or input gate, it can be resumed.

### State Persistence

- Resume state stored in `$LOBSTER_STATE_DIR/` (default: `~/.lobster/state/`).
- Files: `pipeline_resume_<uuid>.json`, `workflow_resume_<uuid>.json`.
- Approval index: `approval_<8hex>.json` → maps short ID to state key.

### Resume Commands

```bash
# Approve and continue
lobster resume --token <base64url_token> --approve yes
lobster resume --id <8hex> --approve yes

# Reject and cancel
lobster resume --token <token> --approve no
lobster resume --id <8hex> --cancel

# Provide input response
lobster resume --token <token> --response-json '{"approved": true}'
```

### Resume Token Structure

Tokens are base64url-encoded JSON:

```jsonc
// Pipeline resume
{ "protocolVersion": 1, "v": 1, "kind": "pipeline-resume", "stateKey": "pipeline_resume_<uuid>" }

// Workflow file resume
{ "protocolVersion": 1, "v": 1, "kind": "workflow-file", "stateKey": "workflow_resume_<uuid>" }
```

### Resume Rules

- **Never auto-approve** on behalf of a user.
- Treat `status: "needs_approval"` as a hard stop.
- Resume only after explicit user decision.

---

## 11. Retry & Error Handling

### Retry Configuration

```yaml
retry:
  max: 3                  # max attempts (default: 1 = no retry)
  backoff: exponential    # "fixed" (default) or "exponential"
  delay_ms: 500           # base delay in ms (default: 1000)
  max_delay_ms: 10000     # delay cap in ms (default: 30000)
  jitter: true            # ±10% randomization (default: false)
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max` | number | `1` | Total attempts (1 = no retry) |
| `backoff` | string | `"fixed"` | `"fixed"` or `"exponential"` |
| `delay_ms` | number | `1000` | Base delay between retries |
| `max_delay_ms` | number | `30000` | Cap on delay (exponential only) |
| `jitter` | boolean | `false` | ±10% random variance on delay |

**Behavior:**
- Abort/cancellation errors are **never** retried.
- Each retry logs to stderr: `[RETRY] Step 'id' failed (attempt N/M): ... Retrying in Xms...`
- After all retries exhausted, the step fails per `on_error` policy.

### Error Handling: `on_error`

| Value | Behavior |
|-------|----------|
| `"stop"` (default) | Throw error and halt workflow |
| `"continue"` | Log error, continue to next step |
| `"skip_rest"` | Log error, skip all remaining steps |

When `on_error` is `"continue"` or `"skip_rest"`, the step result contains:
```json
{ "id": "step_id", "error": true, "errorMessage": "..." }
```

### Timeout

```yaml
timeout_ms: 5000    # kill step after 5 seconds (SIGKILL)
```

Range: 1 to 2,147,483,647 ms.

---

## 12. Environment Variables

### Workflow Runtime

| Variable | Purpose | Default |
|----------|---------|---------|
| `LOBSTER_STATE_DIR` | State storage directory | `~/.lobster/state` |
| `LOBSTER_ARGS_JSON` | JSON-serialized workflow args | — |
| `LOBSTER_ARG_<NAME>` | Individual arg (key uppercased, non-alnum → `_`) | — |
| `LOBSTER_SHELL` | Shell for `run`/`command` steps | System default |
| `LOBSTER_CACHE_DIR` | Cache directory | — |
| `LOBSTER_MAX_TOOL_ENVELOPE_BYTES` | Max envelope size | 512KB |

### Approval & Identity

| Variable | Purpose |
|----------|---------|
| `LOBSTER_APPROVAL_INITIATED_BY` | Initiator identity |
| `LOBSTER_APPROVAL_APPROVED_BY` | Approver identity (set at resume) |
| `LOBSTER_APPROVAL_REQUIRED_APPROVER` | Required approver identity |
| `LOBSTER_APPROVAL_REQUIRE_DIFFERENT_APPROVER` | Must differ from initiator (`true`/`1`/`yes`/`y`) |
| `LOBSTER_APPROVAL_INPUT_TIMEOUT_MS` | TTY input timeout (ms) |

### LLM Integration

| Variable | Purpose |
|----------|---------|
| `LOBSTER_LLM_PROVIDER` | Provider: `openclaw`, `pi`, `http` |
| `LOBSTER_LLM_ADAPTER_URL` | Generic LLM adapter endpoint |
| `LOBSTER_LLM_ADAPTER_TOKEN` | Generic adapter auth token |
| `LOBSTER_PI_LLM_ADAPTER_URL` | Pi extension endpoint |
| `LOBSTER_LLM_MODEL` | Model override |
| `LOBSTER_LLM_FORCE_REFRESH` | Bypass cache |
| `LOBSTER_LLM_PRICING_JSON` | Cost tracking JSON |
| `LOBSTER_LLM_SCHEMA_VERSION` | Schema validation version |
| `LOBSTER_LLM_VALIDATION_RETRIES` | Retry count for schema validation |

### OpenClaw / Clawd

| Variable | Purpose |
|----------|---------|
| `OPENCLAW_URL` / `CLAWD_URL` | OpenClaw gateway URL |
| `OPENCLAW_TOKEN` / `CLAWD_TOKEN` | Authentication token |

---

## 13. SDK (Programmatic API)

### Core Class: `Lobster`

```typescript
import { Lobster } from 'lobster-sdk';

const result = await new Lobster({ env: process.env })
  .pipe(fetchItems)
  .pipe(approve({ prompt: 'Send emails?' }))
  .pipe(sendEmails)
  .run();
```

**Methods:**

| Method | Description |
|--------|-------------|
| `pipe(stage)` | Chain a stage |
| `run(initialInput?)` | Execute the pipeline |
| `resume(token, options?)` | Resume after halt |
| `clone()` | Independent copy |
| `meta(metadata)` | Attach metadata |
| `getMeta()` | Retrieve metadata |

**Stage types accepted by `pipe()`:**

1. **Async generator function:** `async function* (stream, ctx) { ... yield item; }`
2. **Async function (collects input):** `async function (items, ctx) { return transformed; }`
3. **Primitive object with `run()`:** `approve({ prompt })`, `stateSet('key')`

### Built-in Primitives

```typescript
import { approve, stateGet, stateSet, readState, writeState, diffLast, diffGate, exec } from 'lobster-sdk';
```

| Primitive | Description |
|-----------|-------------|
| `approve({ prompt, preview? })` | Approval gate |
| `stateGet(key)` | Read state (pipeline stage) |
| `stateSet(key)` | Write state (pipeline stage) |
| `readState(key, opts)` | Read state (direct, non-pipeline) |
| `writeState(key, value, opts)` | Write state (direct, non-pipeline) |
| `diffLast(key)` | Compare & store; pass diff result downstream |
| `diffGate(key)` | Halt pipeline if unchanged |
| `exec(cmd, opts?)` | Shell execution (`{ json?, shell?, cwd? }`) |

### Result Type

```typescript
type LobsterResult = {
  ok: boolean;
  status: 'ok' | 'needs_approval' | 'needs_input' | 'cancelled' | 'error';
  output: any[];
  requiresApproval: { prompt, items, resumeToken } | null;
  requiresInput: { prompt, responseSchema, defaults?, subject?, resumeToken } | null;
  error?: { type, message } | null;
};
```

---

## 14. Built-in Workflow Registry

Pre-built workflows available via `workflows.run`:

### `github.pr.monitor`

Monitor a PR via `gh` CLI and diff against last state.

```bash
lobster 'workflows.run --name github.pr.monitor --args-json "{\"repo\":\"owner/repo\",\"pr\":123}"'
```

| Arg | Required | Description |
|-----|----------|-------------|
| `repo` | ✓ | GitHub repo (`owner/repo`) |
| `pr` | ✓ | Pull request number |
| `key` | ✗ | State key override |
| `changesOnly` | ✗ | Only emit on change |
| `summaryOnly` | ✗ | Emit summary only |

### `github.pr.monitor.notify`

Monitor a PR and emit a human-friendly message when it changes.

| Arg | Required | Description |
|-----|----------|-------------|
| `repo` | ✓ | GitHub repo (`owner/repo`) |
| `pr` | ✓ | Pull request number |
| `key` | ✗ | State key override |
