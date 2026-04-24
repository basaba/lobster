import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExpr, evaluate } from '../src/core/expr.js';

// Helper
function eval_(expr: string, item: unknown = {}): unknown {
  return evaluate(parseExpr(expr), item);
}

// ---- Literals ----

test('expr: number literal', () => {
  assert.equal(eval_('42'), 42);
  assert.equal(eval_('3.14'), 3.14);
});

test('expr: string literal', () => {
  assert.equal(eval_('"hello"'), 'hello');
  assert.equal(eval_("'world'"), 'world');
});

test('expr: boolean literals', () => {
  assert.equal(eval_('true'), true);
  assert.equal(eval_('false'), false);
});

test('expr: null literal', () => {
  assert.equal(eval_('null'), null);
});

// ---- Path access ----

test('expr: bare path access', () => {
  assert.equal(eval_('name', { name: 'alice' }), 'alice');
  assert.equal(eval_('a.b.c', { a: { b: { c: 42 } } }), 42);
});

test('expr: $ root path', () => {
  assert.equal(eval_('$.name', { name: 'bob' }), 'bob');
});

test('expr: missing path returns undefined', () => {
  assert.equal(eval_('x.y.z', { x: 1 }), undefined);
});

// ---- Arithmetic ----

test('expr: arithmetic operators', () => {
  assert.equal(eval_('2 + 3'), 5);
  assert.equal(eval_('10 - 3'), 7);
  assert.equal(eval_('4 * 5'), 20);
  assert.equal(eval_('10 / 4'), 2.5);
  assert.equal(eval_('10 % 3'), 1);
});

test('expr: operator precedence', () => {
  assert.equal(eval_('2 + 3 * 4'), 14);
  assert.equal(eval_('(2 + 3) * 4'), 20);
});

test('expr: unary minus', () => {
  assert.equal(eval_('-5'), -5);
  assert.equal(eval_('10 + -3'), 7);
});

// ---- Comparison ----

test('expr: comparison operators', () => {
  assert.equal(eval_('1 == 1'), true);
  assert.equal(eval_('1 != 2'), true);
  assert.equal(eval_('1 < 2'), true);
  assert.equal(eval_('2 <= 2'), true);
  assert.equal(eval_('3 > 2'), true);
  assert.equal(eval_('3 >= 3'), true);
});

// ---- Logic ----

test('expr: logical operators', () => {
  assert.equal(eval_('true && true'), true);
  assert.equal(eval_('true && false'), false);
  assert.equal(eval_('false || true'), true);
  assert.equal(eval_('!true'), false);
  assert.equal(eval_('!false'), true);
});

test('expr: short-circuit evaluation', () => {
  // Should not error even though second operand would access missing path
  assert.equal(eval_('false && x.y.z', {}), false);
});

// ---- Functions ----

test('expr: length()', () => {
  assert.equal(eval_('length(items)', { items: [1, 2, 3] }), 3);
  assert.equal(eval_('length(name)', { name: 'hello' }), 5);
  assert.equal(eval_('length(x)', {}), 0);
});

test('expr: every() with @ scoping', () => {
  const item = { votes: [0, 0, 0] };
  assert.equal(eval_('every(votes, @ == 0)', item), true);

  const item2 = { votes: [0, 1, 0] };
  assert.equal(eval_('every(votes, @ == 0)', item2), false);
});

test('expr: every() with empty array', () => {
  assert.equal(eval_('every(items, @ == 0)', { items: [] }), true);
});

test('expr: every() with object elements and @.field', () => {
  const item = { reviewers: [{ vote: 0 }, { vote: 0 }] };
  assert.equal(eval_('every(reviewers, @.vote == 0)', item), true);

  const item2 = { reviewers: [{ vote: 0 }, { vote: 10 }] };
  assert.equal(eval_('every(reviewers, @.vote == 0)', item2), false);
});

test('expr: some()', () => {
  assert.equal(eval_('some(items, @ > 5)', { items: [1, 2, 10] }), true);
  assert.equal(eval_('some(items, @ > 5)', { items: [1, 2, 3] }), false);
  assert.equal(eval_('some(items, @ > 5)', { items: [] }), false);
});

test('expr: count()', () => {
  assert.equal(eval_('count(items, @ > 2)', { items: [1, 2, 3, 4, 5] }), 3);
  assert.equal(eval_('count(items, @ > 10)', { items: [1, 2] }), 0);
});

test('expr: concat()', () => {
  assert.equal(eval_('concat(first, " ", last)', { first: 'John', last: 'Doe' }), 'John Doe');
});

test('expr: lower() and upper()', () => {
  assert.equal(eval_('lower("HELLO")'), 'hello');
  assert.equal(eval_('upper("hello")'), 'HELLO');
});

test('expr: trim()', () => {
  assert.equal(eval_('trim("  hi  ")'), 'hi');
});

test('expr: contains()', () => {
  assert.equal(eval_('contains("hello world", "world")'), true);
  assert.equal(eval_('contains("hello", "xyz")'), false);
  assert.equal(eval_('contains(items, 3)', { items: [1, 2, 3] }), true);
});

test('expr: starts_with() and ends_with()', () => {
  assert.equal(eval_('starts_with("hello", "hel")'), true);
  assert.equal(eval_('ends_with("hello", "llo")'), true);
});

test('expr: coalesce()', () => {
  assert.equal(eval_('coalesce(null, null, 42)'), 42);
  assert.equal(eval_('coalesce(x, "default")', {}), 'default');
  assert.equal(eval_('coalesce("first", "second")'), 'first');
});

test('expr: is_null()', () => {
  assert.equal(eval_('is_null(null)'), true);
  assert.equal(eval_('is_null(x)', {}), true);
  assert.equal(eval_('is_null(x)', { x: 1 }), false);
});

test('expr: exists()', () => {
  assert.equal(eval_('exists(x)', { x: 1 }), true);
  assert.equal(eval_('exists(x)', {}), false);
});

test('expr: days_since() returns positive number for past date', () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const result = eval_('days_since(d)', { d: yesterday }) as number;
  assert.ok(result > 0.9 && result < 1.1, `Expected ~1, got ${result}`);
});

test('expr: hours_since()', () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString();
  const result = eval_('hours_since(d)', { d: twoHoursAgo }) as number;
  assert.ok(result > 1.9 && result < 2.1, `Expected ~2, got ${result}`);
});

test('expr: days_since() with invalid date returns null', () => {
  assert.equal(eval_('days_since(d)', { d: 'not-a-date' }), null);
});

test('expr: now() returns ISO string', () => {
  const result = eval_('now()') as string;
  assert.ok(typeof result === 'string');
  assert.ok(!Number.isNaN(new Date(result).getTime()));
});

// ---- Error cases ----

test('expr: unknown function throws', () => {
  assert.throws(() => eval_('unknown_fn(1)'), /Unknown function/);
});

test('expr: bad syntax throws', () => {
  assert.throws(() => parseExpr('1 +'), /Unexpected/);
});

// ---- Complex expressions ----

test('expr: nested function calls', () => {
  assert.equal(eval_('length(concat("a", "bc"))'), 3);
});

test('expr: combined logic and comparison', () => {
  const item = { age: 25, active: true };
  assert.equal(eval_('age > 18 && active == true', item), true);
  assert.equal(eval_('age < 18 || active == false', item), false);
});

// ---- Hyphenated property names ----

test('expr: $.hyphen-key resolves hyphenated property', () => {
  assert.equal(eval_('$.user-name', { 'user-name': 'Alice' }), 'Alice');
});

test('expr: nested hyphenated property via $', () => {
  assert.equal(
    eval_('$.user.first-name', { user: { 'first-name': 'Bob' } }),
    'Bob',
  );
});

test('expr: @.hyphen-key inside predicate', () => {
  const item = { items: [{ 'is-active': true }, { 'is-active': false }] };
  assert.equal(eval_('some(items, @.is-active == true)', item), true);
});

test('expr: multi-segment hyphenated key (my-long-name)', () => {
  assert.equal(eval_('$.my-long-name', { 'my-long-name': 42 }), 42);
});

test('expr: spaced minus is still subtraction', () => {
  assert.equal(eval_('$.x - $.y', { x: 10, y: 3 }), 7);
});

test('expr: dot access then spaced subtraction', () => {
  assert.equal(eval_('$.foo.bar - 1', { foo: { bar: 5 } }), 4);
});

test('expr: bare path with dot-hyphen', () => {
  assert.equal(eval_('user.first-name', { user: { 'first-name': 'Eve' } }), 'Eve');
});

// ---- Bracket notation ----

test('expr: $["key"] accesses property with special chars', () => {
  assert.equal(eval_('$["my.key"]', { 'my.key': 'value' }), 'value');
});

test('expr: $.obj["first name"] nested bracket access', () => {
  assert.equal(eval_('$.user["first name"]', { user: { 'first name': 'Alice' } }), 'Alice');
});

test('expr: @["type/kind"] in predicate', () => {
  const item = { items: [{ 'type/kind': 'a' }, { 'type/kind': 'b' }] };
  assert.equal(eval_('some(items, @["type/kind"] == "a")', item), true);
});

test('expr: $["a"]["b"] chained brackets', () => {
  assert.equal(eval_('$["a"]["b"]', { a: { b: 42 } }), 42);
});

test('expr: $[0] numeric index on array', () => {
  assert.equal(eval_('$.items[0]', { items: ['x', 'y', 'z'] }), 'x');
});

test('expr: mixed dot and bracket: $.users[1].name', () => {
  const item = { users: [{ name: 'Alice' }, { name: 'Bob' }] };
  assert.equal(eval_('$.users[1].name', item), 'Bob');
});

test('expr: bracket with implicit root', () => {
  assert.equal(eval_('users[0]', { users: ['first'] }), 'first');
});

test('expr: malformed bracket throws', () => {
  assert.throws(() => parseExpr('$["x"'), /Expected \]/);
});
