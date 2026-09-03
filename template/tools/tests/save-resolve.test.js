/* Plain-Node tests for js/save-resolve.js - no test framework.
   Run: node template/tools/tests/save-resolve.test.js
   Exits non-zero (and prints a stack) on the first failed assertion.

   Lives under template/tools/ (not repo-root tests/) because this repo
   root is just the setup scaffolder - template/ IS the engine project
   that setup.py copies into every new game, and tools/ is where its
   other dev-only, never-shipped-in-the-built-game tooling already lives
   (the packager, devlog.js). ARCHIVE_DIRS in projectpackager-windows.py
   is (css, js, src) only, so this directory never ends up in a built
   game archive. */
'use strict';

const assert = require('node:assert');
const path = require('node:path');

const SR = require(path.join(__dirname, '..', '..', 'js', 'save-resolve.js'));

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok - ' + name);
}

/* ---------- fixtures ---------- */

function say(who, text) { return { op: 'say', who: who, text: text }; }
function label(name) { return { op: 'label', name: name }; }
function jump(to) { return { op: 'jump', to: to }; }
function show(who, expr, pos) { return { op: 'show', who: who, expr: expr, pos: pos }; }
function showXY(who, expr, extra) {
  var o = { op: 'show', who: who, expr: expr, pos: null };
  for (var k in extra) o[k] = extra[k];
  return o;
}
function move(who, extra) {
  var o = { op: 'move', who: who };
  for (var k in extra) o[k] = extra[k];
  return o;
}

// A small script with two labels ("start", "act2"), each with a few `say`
// lines, mirroring how real chapter scripts are shaped.
function fixtureScript() {
  return [
    label('start'),           // 0
    say('ari', 'Hi there.'),  // 1
    say('ari', 'How are you?'), // 2
    say('mc', '(Fine, I guess.)'), // 3
    jump('act2'),              // 4
    label('act2'),             // 5
    say('ari', 'Ready?'),      // 6
    say('mc', '(Yes.)'),       // 7
    say('ari', 'Great, let\'s go.'), // 8
  ];
}

/* ================= hashStr ================= */

test('hashStr is deterministic for the same input', () => {
  assert.strictEqual(SR.hashStr('hello world'), SR.hashStr('hello world'));
});

test('hashStr differs for different input', () => {
  assert.notStrictEqual(SR.hashStr('hello world'), SR.hashStr('hello world!'));
});

/* ================= digestOps ================= */

test('digestOps: same digest when only say() text changes (the fix)', () => {
  const a = fixtureScript();
  const b = fixtureScript();
  b[1].text = 'Hi there, completely different wording now!';
  b[2].text = 'How ARE you???';
  assert.strictEqual(SR.digestOps(a), SR.digestOps(b));
  assert.strictEqual(SR.hashStr(SR.digestOps(a)), SR.hashStr(SR.digestOps(b)));
});

test('digestOps: different digest when say() who changes', () => {
  const a = fixtureScript();
  const b = fixtureScript();
  b[1].who = 'someone-else';
  assert.notStrictEqual(SR.digestOps(a), SR.digestOps(b));
});

test('digestOps: different digest when a non-say field changes (jump target)', () => {
  const a = fixtureScript();
  const b = fixtureScript();
  b[4].to = 'somewhere-else';
  assert.notStrictEqual(SR.digestOps(a), SR.digestOps(b));
});

test('digestOps: different digest when op order changes', () => {
  const a = fixtureScript();
  const b = fixtureScript();
  // Swap a say('ari', ...) with a say('mc', ...) - the `who` field differs,
  // so reordering them is visible in the digest even though dialogue text
  // itself is no longer hashed.
  const tmp = b[1]; b[1] = b[3]; b[3] = tmp;
  assert.notStrictEqual(SR.digestOps(a), SR.digestOps(b));
});

test('digestOps: legacy show(who,expr,pos) digests to exactly "show|who|expr|pos"', () => {
  // Guards the upgrade-safety guarantee: a project that only uses
  // left/center/right must hash byte-for-byte as it did before x/y/move
  // existed, so existing player saves don't trip the "out of date" prompt.
  const line = SR.digestOps([show('ari', 'idle', 'left')]);
  assert.strictEqual(line, 'show|ari|idle|left');
});

test('digestOps: explicit x/y/scale on show changes the digest', () => {
  const a = SR.digestOps([show('ari', 'idle', 'left')]);
  const b = SR.digestOps([showXY('ari', 'idle', { x: '30%' })]);
  assert.notStrictEqual(a, b);
  const c = SR.digestOps([showXY('ari', 'idle', { x: '30%', y: '5%' })]);
  assert.notStrictEqual(b, c);
  // scale alone (named position, no x/y) still shifts the hash
  const named = SR.digestOps([show('ari', 'idle', 'left')]);
  const scaled = SR.digestOps([{ op: 'show', who: 'ari', expr: 'idle', pos: 'left', scale: 150 }]);
  assert.notStrictEqual(named, scaled);
});

test('digestOps: transition/duration on show do NOT change the digest', () => {
  const a = SR.digestOps([show('ari', 'idle', 'left')]);
  const b = SR.digestOps([showXY('ari', 'idle',
    { pos: 'left', transition: 'slide-right', duration: 450 })]);
  // showXY sets pos:null then overwrites with pos:'left' -> same pos, no x/y,
  // cosmetic fields ignored -> identical digest.
  assert.strictEqual(a, b);
});

test('digestOps: a move op changes the digest', () => {
  const base = fixtureScript();
  const withMove = fixtureScript();
  withMove.splice(2, 0, move('ari', { pos: 'right', duration: 900 }));
  assert.notStrictEqual(SR.digestOps(base), SR.digestOps(withMove));
});

test('digestOps: move who/pos/x/y/scale each change the digest', () => {
  const p = SR.digestOps([move('ari', { pos: 'right' })]);
  assert.notStrictEqual(p, SR.digestOps([move('mio', { pos: 'right' })]));
  assert.notStrictEqual(p, SR.digestOps([move('ari', { pos: 'left' })]));
  assert.notStrictEqual(p, SR.digestOps([move('ari', { x: '60%' })]));
  assert.notStrictEqual(SR.digestOps([move('ari', { x: '60%' })]),
                        SR.digestOps([move('ari', { x: '60%', y: '4%' })]));
  assert.notStrictEqual(p, SR.digestOps([move('ari', { pos: 'right', scale: 120 })]));
});

test('digestOps: transition/duration on move do NOT change the digest', () => {
  const a = SR.digestOps([move('ari', { pos: 'right' })]);
  const b = SR.digestOps([move('ari', { pos: 'right', duration: 900, transition: 'ease-out' })]);
  assert.strictEqual(a, b);
});

test('digestOps: PlayTestLog (log) ops are ignored - adding one does not change the digest', () => {
  const base = fixtureScript();
  const withLog = fixtureScript();
  withLog.splice(2, 0,
    { op: 'log', message: 'debug: here', level: 'normal' },
    { op: 'log', message: () => 'x', level: 'critical' });
  assert.strictEqual(SR.digestOps(base), SR.digestOps(withLog));
});

test('resolvePos round-trips through a script containing move ops', () => {
  const ops = fixtureScript();
  ops.splice(2, 0, move('ari', { pos: 'right', duration: 600 }));
  const info = SR.buildLabels(ops);
  const ptr = 8; // still under label 'act2'
  const pos = SR.posFromPtr(info.labels, info.sorted, ptr);
  assert.strictEqual(SR.resolvePos(info.labels, ops.length, pos), ptr);
});

/* ================= buildLabels / segmentNameAt ================= */

test('buildLabels + segmentNameAt: resolves the nearest preceding label', () => {
  const ops = fixtureScript();
  const info = SR.buildLabels(ops);
  assert.deepStrictEqual(info.labels, { start: 0, act2: 5 });
  assert.strictEqual(SR.segmentNameAt(info.sorted, 0), 'start');
  assert.strictEqual(SR.segmentNameAt(info.sorted, 3), 'start');
  assert.strictEqual(SR.segmentNameAt(info.sorted, 5), 'act2');
  assert.strictEqual(SR.segmentNameAt(info.sorted, 8), 'act2');
});

test('segmentNameAt: ptr before any label resolves to empty string', () => {
  const ops = [say('ari', 'cold open, no label yet'), label('start'), say('ari', 'hi')];
  const info = SR.buildLabels(ops);
  assert.strictEqual(SR.segmentNameAt(info.sorted, 0), '');
  assert.strictEqual(SR.segmentNameAt(info.sorted, 1), 'start');
});

test('buildLabels: flags duplicate label names', () => {
  const ops = [label('start'), say('ari', 'hi'), label('start'), say('ari', 'again')];
  const info = SR.buildLabels(ops);
  assert.strictEqual(info.dupes.start, true);
  // Last write wins, matching the original engine.js LABELS-building loop.
  assert.strictEqual(info.labels.start, 2);
});

/* ================= posFromPtr / resolvePos: survives script edits ================= */

test('resolvePos(posFromPtr(ptr)) round-trips to the same op when nothing changed', () => {
  const ops = fixtureScript();
  const info = SR.buildLabels(ops);
  const ptr = 7; // say('mc', '(Yes.)') under label 'act2'
  const pos = SR.posFromPtr(info.labels, info.sorted, ptr);
  assert.deepStrictEqual(pos, { label: 'act2', offset: 2 });
  const resolved = SR.resolvePos(info.labels, ops.length, pos);
  assert.strictEqual(resolved, ptr);
  assert.strictEqual(ops[resolved].text, '(Yes.)');
});

test('inserting lines in an EARLIER label does not move a save in a LATER label', () => {
  const ops = fixtureScript();
  const info = SR.buildLabels(ops);
  const ptr = 7; // say('mc', '(Yes.)') under label 'act2', offset 2
  const pos = SR.posFromPtr(info.labels, info.sorted, ptr);
  const savedOp = ops[ptr];

  // Insert two new lines into the earlier 'start' segment.
  const edited = fixtureScript();
  edited.splice(2, 0,
    say('ari', 'A brand new line.'),
    say('ari', 'Another new line.'));

  const info2 = SR.buildLabels(edited);
  const resolved = SR.resolvePos(info2.labels, edited.length, pos);
  assert.strictEqual(edited[resolved].op, savedOp.op);
  assert.strictEqual(edited[resolved].who, savedOp.who);
  assert.strictEqual(edited[resolved].text, savedOp.text);
});

test('inserting lines in the SAME segment before the saved line is a known limitation: offset shifts with it', () => {
  // The (label, offset) scheme only anchors at label granularity - it
  // protects saves in *other* segments (see the test above), but an
  // insert before the saved line within the *same* segment still shifts
  // the offset, same as it always would have. This test documents that
  // behavior precisely (mechanical offset math) rather than pretending
  // it's magically immune within a segment too.
  const ops = fixtureScript();
  const info = SR.buildLabels(ops);
  const ptr = 8; // say('ari', "Great, let's go.") under label 'act2', offset 3
  const pos = SR.posFromPtr(info.labels, info.sorted, ptr);

  // Insert a new line inside 'act2', before the saved line (right after label('act2')).
  const edited = fixtureScript();
  edited.splice(6, 0, say('ari', 'One more beat before this.'));

  const info2 = SR.buildLabels(edited);
  const resolved = SR.resolvePos(info2.labels, edited.length, pos);
  // Offset arithmetic is unaffected by the edit (label index didn't move),
  // so resolved == labels.act2 + offset == the same absolute slot as
  // before the insert - which is now one line earlier than the original line.
  assert.strictEqual(resolved, ptr);
  assert.strictEqual(edited[resolved].text, '(Yes.)');
});

test('resolvePos falls back to raw ptr for legacy positions with no label', () => {
  const ops = fixtureScript();
  const info = SR.buildLabels(ops);
  const resolved = SR.resolvePos(info.labels, ops.length, { ptr: 3 });
  assert.strictEqual(resolved, 3);
});

test('resolvePos clamps out-of-range positions into bounds', () => {
  const ops = fixtureScript();
  const info = SR.buildLabels(ops);
  const tooFar = SR.resolvePos(info.labels, ops.length, { label: 'act2', offset: 999 });
  assert.strictEqual(tooFar, ops.length);
  const negative = SR.resolvePos(info.labels, ops.length, { ptr: -5 });
  assert.strictEqual(negative, 0);
});

console.log(passed + ' passed');
