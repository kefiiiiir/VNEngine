# Writing your story

This folder is your novel. Everything else in `js/` (`engine.js`,
`save-resolve.js`, `audio.js`) is the runtime and is usually left alone;
`js/data.js`, just outside this folder, is your assets manifest. This is
the guide to what goes in here, and how to script a scene.

```
js/story/
  story-helpers.js   op builders (say, bg, show, choice, ...) - shared, don't duplicate
  chapter1.js         your script, chapter 1                  (EDIT THIS)
  chapter2.js         your script, chapter 2                  (EDIT THIS / add more)
  README.md           this file
```

---

## 1. Adding and editing chapters

A script is `{ ops: [ ... ] }` - a flat array the engine walks top to
bottom, moving an instruction pointer; `label` / `jump` / `if` / `choice`
redirect it. Rather than one giant file, that array is built up across one
file per chapter: `chapter1.js`, `chapter2.js`, and so on.

Each chapter file is a small IIFE that builds its own local `ops` array,
then **appends** it onto the shared script:

```js
(function (global) {
  'use strict';
  var ops = [ /* ... this chapter's ops ... */ ];
  global.VNScript = global.VNScript || { ops: [] };
  global.VNScript.ops = global.VNScript.ops.concat(ops);
})(window);
```

The op builders (`say`, `bg`, `show`, `choice`, `label`, `jump`, ...) live
in `story-helpers.js`, loaded once before any chapter file - use them in
every chapter exactly as shown in the op reference below, no prefix
needed.

**To add a chapter:** create `js/story/chapter3.js` (copy the pattern
above), and add `<script src="js/story/chapter3.js"></script>` to
`index.html`, after the previous chapter and before `save-resolve.js`.

The engine merges every chapter's ops into one script before it boots, so:

- **Labels must stay unique across every chapter file**, not just within
  one - the boot-time validator checks the merged script and will flag a
  duplicate wherever it came from.
- A `jump`, `if`, or a `choice` option's `to` can target a label in any
  chapter, earlier or later.
- A `chapterEnd`'s `next` commonly points at the first label of the
  following chapter (see the demo: `chapter1.js` ends pointing at a label
  defined in `chapter2.js`) - but it can point anywhere, same as `jump`.

At boot the engine validates the merged script and prints anything
suspect (unknown `jump`/`choice` targets, duplicate labels, characters or
sfx names it doesn't recognise, unreachable ops), each with the op index.
It never stops the game - it just tells you. This goes to the browser
console and, when you're running `playtest.py` with a console, straight
into that terminal.

### Example

The shipped `chapter1.js` (and `chapter2.js`) is the worked example. The
shape of it:

```js
var ops = [
  label('start'),
  music('theme', { volume: 0.5, fade: 2 }),

  bg('room'),
  show('ari', 'idle', 'left'),
  say('ari', 'Hi, {first}!', 'talk'),

  say('ari', 'Are we friends?', 'talk'),
  choice([
    { text: 'Of course',      to: 'yes', set: { warmth: 1 } },
    { text: "Let's see",      to: 'no' }
  ]),

  label('yes'), say('ari', 'Knew it.', 'talk'), jump('end'),
  label('no'),  say('ari', 'Fair.', 'bad'),

  label('end'),
  iff(function (s) { return s.vars.warmth > 0; }, 'warm_end'),
  narr('You kept your distance.'),
  jump('finish'),
  label('warm_end'),
  narr('You said yes without thinking.'),

  label('finish'),
  saveOp('End of chapter 1'),
  chapterEnd('Chapter 1', null)
];
```

---

## 2. Text tokens

Usable in any spoken or narration string:

| token       | becomes                                   |
|-------------|-------------------------------------------|
| `{first}`   | player first name                         |
| `{last}`    | player last name                         |
| `{name}`    | `"first last"` trimmed                    |
| `{anyVar}`  | the value of `s.vars.anyVar` from `set()` |

Unknown `{tokens}` are left as-is. The name comes from the built-in
name-entry screen shown on **New game**. Don't need it? Leave the fields
blank - `{first}` falls back to `"Player"`.

## 3. Text markup

Applied **after** escaping, so player names and variable values can never
inject HTML:

| markup            | renders          |
|-------------------|------------------|
| `[b]bold[/b]`     | **bold**         |
| `[i]italic[/i]`   | *italic*         |
| `[c=#ff8ec4]…[/c]` | coloured span (hex or CSS colour name only) |

## 4. Stage

| op | signature | example |
|----|-----------|---------|
| `bg` | `bg(name)` | `bg('room')` - crossfades to a background from `VNData.BACKGROUNDS` (or a raw path) |
| `show` | `show(who, expr, where, opts?)` | `show('ari', 'talk', 'left')` - `where` is a position **name** (`'left'` \| `'center'` \| `'right'` \| anything in `VNData.POSITIONS`) **or** an options object `{ pos, x, y, scale, transition, duration }`; when `where` is a name, an optional `opts` object adds the rest, e.g. `show('ari', 'talk', 'center', { scale: 130 })` |
| `hide` | `hide(who, opts?)` | `hide('ari')` or `hide('ari', { transition: 'slide-right', duration: 400 })` |
| `move` | `move(who, dest, opts?)` | `move('ari', { pos: 'right', duration: 900 })` - reposition an already-shown character; `dest` is a name or `{ pos, x, y, scale, transition, duration }`, with the same optional `opts` shorthand as `show`. `duration` (ms) smooths the glide - `x`, `y` **and** `scale` animate together; absent or `0` = instant jump. Does **not** pause the script - use `pause(ms)` to wait for it. Moving a character who was never `show`n logs a warning and is ignored. |

The speaking character is auto-highlighted; the rest dim.

**Transitions.** `show` / `hide` / `move` all take `transition` (which effect)
and `duration` (ms - the length of the transition itself, *not* how long the
character stays on screen; default 300, `0` = snap).

| `show` / `hide` `transition` | effect |
|---|---|
| `fade` *(default)* | opacity only |
| `rise` | fade + rises up into place on `show`; sinks + fades on `hide` |
| `slide-left` | character is parked off the **right** edge - slides in from there on `show`, slides back out to it on `hide` |
| `slide-right` | character is parked off the **left** edge - slides in from there on `show`, slides back out to it on `hide` |

| `move` `transition` | easing |
|---|---|
| `glide` *(default)* | ease-in-out |
| `linear` | constant speed |
| `ease-in` | accelerate away |
| `ease-out` | decelerate into the stop |

`show` only plays an enter transition when the character isn't already on
stage; re-`show`ing someone just swaps their sprite. Restoring a save,
rolling back and jumping to a checkpoint all **snap** the stage into place
with no animation, and `prefers-reduced-motion` drops every transition to an
instant cut.

## 5. Text

| op | signature | example |
|----|-----------|---------|
| `say` | `say(who, text, expr, voice)` | `say('ari', 'Hi, {first}!', 'talk')` - `expr` also swaps the on-stage sprite; `voice` is an optional `SFX_FILES` name played for the line |
| `narr` | `narr(text)` | `narr('The room is empty.')` - narration, no name box |
| `mc` | `mc(text)` | `mc('(What now?)')` - the player's own voice |

Text types out; a click / Space / Enter completes the line, the next
click advances. The in-game top bar has the reading controls (buttons
only - no key bindings to collide with anything):

| button | does |
|--------|------|
| ↶ | roll back one line (50-line buffer) |
| ▤ | open the backlog / history overlay |
| ⏩ | skip - fast-forwards, stops at every choice (toggle) |
| ▶ | auto-advance (toggle) |

## 6. Flow

| op | signature | example |
|----|-----------|---------|
| `label` | `label(name)` | `label('act2')` - a jump target |
| `jump` | `jump(name)` | `jump('act2')` |
| `iff` | `iff(fn, name)` | `iff(function (s) { return s.vars.warmth > 0; }, 'good_end')` |
| `set` | `set(obj)` | `set({ warmth: 1, met_ari: true })` |
| `choice` | `choice(options)` | see below |

`set` with a **number** adds to the current value (starts at 0); any
other value is assigned. To assign a number outright, wrap it in `abs()`:
`set({ gold: abs(0) })` sets `gold` to 0 rather than adding 0. `iff`'s
function receives the state object - read `s.vars.*` and `s.player.*`.

```js
choice([
  { text: 'Say yes', to: 'yes_branch', set: { warmth: 1 } },
  { text: 'Say no',  to: 'no_branch' },
  { text: 'Hug them', to: 'hug', show: function (s) { return s.vars.warmth > 2; } }
])
```

Each option: `text` (supports tokens + markup), optional `to` (label),
optional `set`, optional `show` (a `s => bool` - the option is hidden
when it returns false). Visible options are renumbered; number keys
`1`-`9` select them.

## 7. Audio

| op | signature | notes |
|----|-----------|-------|
| `music` | `music(name, opts)` | `opts`: `volume` (0-1), `fade` (s), `loop` (default true), `offset` (s), `restart` |
| `stopMusic` | `stopMusic({ fade })` | |
| `sfx` | `sfx(name, opts)` | `opts`: `volume`, `rate`, `times`, `interval` |
| `pause` | `pause(ms)` | wait, then continue automatically |

`sfx(name)` first looks for a **synthesized** sound built into
`js/audio.js`, then for a file registered in `VNData.SFX_FILES`. The
synth palette (no files needed): `click`, `hover`, `confirm`, `back`,
`choice`, `step`, `type`, `error`, `glitch`, `stinger`, `boom`,
`heartbeat`, `riser`, `whisper`, `staticNoise`, `screech`.

`js/audio.js` is self-contained - you can lift it into another project
and use `VNAudio.music() / .sfx() / .duck()` on its own.

## 8. Effects - `fx`

Deliberately minimal.

| call | effect |
|------|--------|
| `fx('shake')` | screen shake (`{ ms }` optional) |
| `fx('flash', { color: 'white' })` | full-screen flash; `color` = `white` \| `red` \| `black` |
| `fx('crushmusic', { on: true })` | lo-fi band-pass on the music; `{ on: false }` restores it |

`shake` and `flash` obey the **Screen effects** setting. `crushmusic` is
the one audio-processing effect kept as a worked example - see
`crushMusic()` in `js/audio.js` to build your own (bit-crush, reverb,
filter sweeps, ...). Music ducking under a line is also available from
code: `VNAudio.duck(amount, ms)`.

## 9. Debug logging - `PlayTestLog`

| op | signature | notes |
|----|-----------|-------|
| `PlayTestLog` | `PlayTestLog(message, level)` | prints a line to the **`playtest.py` terminal** as the story reaches this op - nothing shows on the game screen |

- `message` - a string, **or a function** (it receives the `state` object, so
  `s => 'warmth is ' + s.vars.warmth` works), **or any value** (objects are
  `JSON.stringify`d, everything else `String()`d). A function that throws is
  caught and reported instead of crashing the run.
- `level` - `'normal'` (default, dim) · `'warning'` (amber `!`) ·
  `'critical'` (red `✗`). An unknown level is treated as `'normal'` and noted
  by the boot-time script check.

```js
PlayTestLog('reached the market scene'),
PlayTestLog(s => 'gold=' + s.vars.gold + ' hp=' + s.vars.hp, 'warning'),
PlayTestLog(() => JSON.stringify(computeRouteFlags()), 'critical'),
```

This rides the same browser -> terminal bridge as the boot-time script
check (`tools/devlog.js`), so it only does anything when `playtest.py` has a
console. A packaged **shipping** build has no console and `PlayTestLog` is a
silent no-op - leave the calls in.

## 10. Persistence

| op | signature | notes |
|----|-----------|-------|
| `saveOp` | `saveOp(label)` | drop a checkpoint here (helper is named `saveOp` to avoid shadowing) |
| `chapterEnd` | `chapterEnd(title, next)` | "End of chapter" card; `next` is a label (in this chapter or any other) or `null` (back to title) |
| `toMenu` | `toMenu()` | jump straight to the title screen |

See `VNEngine.md` §5 for how saves and checkpoints actually work under
the hood (anchoring, hashing, what's kept where).
