# VNEngine

A small, code-first visual novel engine. No build step, no framework - four
plain JavaScript files, one stylesheet, one HTML page, and the engine itself
pulls in nothing. You write your novel as a JavaScript array of "ops"; the
engine plays it.

Think of it as the runtime, not the game: like an engine rather than a
finished title. The repository ships with a tiny demo so you can see every
feature working; replace `js/story.js` and `js/data.js` with your own.

It runs as a desktop app, not a hosted web page: `playtest.py` (and every
packaged build) opens the game in its own native window backed by a tiny
local server that stops when you close the window. The two Python packages
that involves - `pywebview` (the window) and `pyinstaller` (packaging) -
are the only dependencies, and `setup` offers to install them.

---

## 1. Running it

**Option A - just open it.** Double-click `index.html`. Everything works
from `file://`, including saves (via `localStorage`).

**Option B - local server.** Some browsers restrict a few things on
`file://` (mainly decoding audio through the Web Audio graph). To avoid
that:

```bash
python playtest.py            # first free port from 8000 up
python playtest.py 5500       # prefer this port (falls forward if taken)
```

`playtest.py` is a minimal static file server and nothing else. It opens
the game in a **native window** (via `pywebview` - `setup` offers to
install it; otherwise `pip install pywebview`); **closing that window
stops the server**, there's no separate Ctrl+C step. If `pywebview` isn't
installed it falls back to opening your default browser and running until
Ctrl+C. Set `VN_NO_BROWSER=1` to serve headlessly (no window).

In dev mode it sends `Cache-Control: no-store`, so the browser always has
your latest edit - just reload, no cache-busting needed.

**Diagnostics in the terminal.** Whenever `playtest.py` has a console to
print to (running from source, or a `development` packaged build), it
injects a tiny dev shim (`tools/devlog.js`) into `index.html` that
forwards the browser console back to the terminal: the boot-time script
check, uncaught errors, and failed image/audio loads all show up where
you're already looking. You never have to open F12. A `shipping` build
has no console and serves `index.html` untouched.

---

## 2. Project layout

```
index.html        screens + DOM the engine drives
css/style.css     all styling; theme via the CSS variables at the top
js/audio.js       music + sound engine  -> window.VNAudio   (self-contained, reusable)
js/data.js        your assets manifest  -> window.VNData     (EDIT THIS)
js/story.js       your script           -> window.VNScript   (EDIT THIS)
js/save-resolve.js  save/position hashing + resolution (usually left alone)
js/engine.js      the runtime           (usually left alone)
src/              your images and audio (see src/README.md)
playtest.py       the local server + native-window launcher
project.json      name / title / author  (setup writes it; titles the window)
tools/            the packager - the "Build" step (see tools/README.md)
```

Load order in `index.html` matters: `audio.js`, `data.js`, `story.js`,
`save-resolve.js`, then `engine.js`. Fonts are bundled in `src/fonts/` and
`@font-face`d in `style.css` - nothing is fetched from the network.

At boot the engine validates your script and prints anything suspect
(unknown `jump`/`choice` targets, duplicate labels, characters or sfx
names it doesn't recognise, unreachable ops), each with the op index. It
never stops the game - it just tells you. This goes to the browser
console *and*, when you're running `playtest.py` with a console,
straight into that terminal (see §1).

---

## 3. Assets - `js/data.js` (`VNData`)

```js
var BACKGROUNDS = {
  room:  'src/img/bg/room.png',
  black: ''            // empty string  ->  plain black screen
};

var CHARACTERS = {
  ari: {
    name:  'Ari',                       // shown in the name box
    color: '#8ecbff',                   // accent (name box + placeholder card)
    sprites: {
      idle:  'src/img/characters/Example/example_idle.png',
      talk:  'src/img/characters/Example/example_talk.png',
      argue: 'src/img/characters/Example/example_argue.png'
      // any keys you like; 'idle' is the fallback
    }
  },
  mio: { name: 'Mio', color: '#ffd9a8', sprites: {} }  // no art -> placeholder card
};

var SFX_FILES = { /* name: 'src/audio/sfx/whatever.mp3' */ };
```

### Positions - `VNData.POSITIONS`

Named spots on the stage. `left` / `center` / `right` are built in; add your
own, or retune the three defaults, here:

```js
var POSITIONS = {
  left:    { x: '18%' },
  center:  { x: '50%' },
  right:   { x: '82%' },
  doorway: { x: '70%', y: '2%' },              // your own name
  closeup: { x: '50%', y: '-6%', scale: 120 }  // nearer AND bigger
};
```

- `x` - the sprite's horizontal **centre**, as a share of stage width.
- `y` - how far to **lift** the sprite off the floor, as a share of stage
  height (positive = up; negative dips it below the floor line, reading as
  "closer"). Defaults to `0`.
- `scale` - sprite size, `100` = normal. Optional; defaults to `100`. Grows
  from the feet, so the character stays standing on the floor.
- `x` / `y` values: a bare number -> pixels; a string (`'50%'`, `'12vw'`, ...)
  passes through untouched.

Omit the whole map and `left` / `center` / `right` still work. Use a name with
`show('ari', 'idle', 'doorway')` or `move('ari', 'closeup')`; skip names and
pass values inline (`show('ari', 'idle', { x: '70%', y: '3%' })`); or keep a
name and add / override just the scale
(`show('ari', 'idle', 'center', { scale: 130 })`). Any combination works - a
missing piece falls back to the name's value, then to the default.

**Graceful degradation.** Missing background -> black. Missing sprite
key -> `idle` -> a labelled placeholder card. Missing sound/music file ->
silence. The engine never throws on a missing asset.

`PRELOAD` is built automatically from the two maps; you don't touch it.

Music files live in `js/audio.js` in the `MUSIC` map:

```js
var MUSIC = { theme: 'src/audio/music/theme.mp3' };
```

---

## 4. Scripting - `js/story.js` (`VNScript`)

A script is `{ ops: [ ... ] }`. The helper functions at the top of
`js/story.js` build the op objects. The engine walks the array from the
top, moving the instruction pointer; `label` / `jump` / `if` / `choice`
redirect it.

### Text tokens

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

### Text markup

Applied **after** escaping, so player names and variable values can never
inject HTML:

| markup            | renders          |
|-------------------|------------------|
| `[b]bold[/b]`     | **bold**         |
| `[i]italic[/i]`   | *italic*         |
| `[c=#ff8ec4]…[/c]` | coloured span (hex or CSS colour name only) |

### Stage

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

### Text

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

### Flow

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

### Audio

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

### Effects - `fx`

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

### Debug logging - `PlayTestLog`

| op | signature | notes |
|----|-----------|-------|
| `PlayTestLog` | `PlayTestLog(message, level)` | prints a line to the **`playtest.py` terminal** (§1) as the story reaches this op - nothing shows on the game screen |

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

### Persistence

| op | signature | notes |
|----|-----------|-------|
| `saveOp` | `saveOp(label)` | drop a checkpoint here (helper is named `saveOp` to avoid shadowing) |
| `chapterEnd` | `chapterEnd(title, next)` | "End of chapter" card; `next` is a label or `null` (back to title) |
| `toMenu` | `toMenu()` | jump straight to the title screen |

---

## 5. Saves & checkpoints

- **Continue** resumes the single most recent auto-save point.
- **Checkpoints** lists every checkpoint (newest first); picking one
  overwrites current progress. A checkpoint is written on every `saveOp`,
  every `chapterEnd`, and from the 💾 button on the in-game top bar.
- A checkpoint stores: position as **(nearest label, offset)** plus a hash
  of the script, `vars`, player name, and the stage (background + who is
  shown where, including any custom `x`/`y`). Up to 30 are kept; oldest
  non-chapter-end ones are dropped first.
- `move` ops and explicit `x`/`y`/`scale` on `show` count toward the
  change-detection hash, but a `transition` / `duration` is cosmetic and does
  not. A script that only uses `left` / `center` / `right` hashes exactly as
  it did before these features existed, so upgrading the engine never
  invalidates an existing save.
- **Editing the script doesn't silently break saves.** Position is
  anchored to the nearest label, so inserting lines inside one scene
  doesn't move saves in later scenes. If the script hash no longer
  matches, load shows a *"Save may be out of date"* prompt - resume
  anyway, restart the chapter, or go back to the title.
- "Seen" (for fast-forward / skip) is global read-tracking, stored once
  under `vnengine_seen` - not copied into every checkpoint.
- **Rollback history and the backlog are memory-only** - the 50-line
  rollback buffer and the on-screen backlog both reset on reload; only
  checkpoints/auto-save/seen-tracking are written to `localStorage`.
- Destructive actions (jump to a checkpoint, return to menu, **Erase save**)
  ask first with an in-engine modal styled like the rest of the game - not a
  browser `confirm()` box. Escape or a click outside cancels.
- Everything lives in `localStorage` under `vnengine_save`,
  `vnengine_checkpoints`, `vnengine_seen`, `vnengine_settings`,
  `vnengine_audio`. If a write fails (quota full) the engine says so
  instead of failing silently. **Erase save** on the title screen clears
  them.

---

## 6. Settings

| setting | what it does |
|---------|--------------|
| Text speed | typewriter rate |
| Music volume / Sound volume / Mute | audio levels (persist immediately) |
| Screen effects | gate for `fx('shake')` / `fx('flash')` |
| Fast-forward seen text | already-seen lines appear instantly |
| Auto-advance delay | pause between lines in auto mode |
| Skip unseen text too | let skip race through unread lines too, not just seen ones |

---

## 7. Theming & notes

- **Colours / fonts:** the `:root` custom properties at the top of
  `css/style.css` (`--pink-*` accent ramp, `--ink*`, `--box-*`,
  `--font-*`). Change them there to reskin everything.
- **Fonts:** bundled woff2 in `src/fonts/`, `@font-face`d at the top of
  `css/style.css`. Swap the files (and the `--font-*` stacks) to change them.
- **Port:** `DEFAULT_PORT` in `playtest.py`, or pass one as an argument;
  either way it scans forward for the first free port.
- **`file://` vs server:** double-clicking `index.html` runs the raw page in
  whatever opened it - fine, and saves still work. `playtest.py` adds the
  native window, the shut-down-on-close behaviour, more reliable audio
  decoding (the engine falls back to a plain `<audio>` element on `file://`),
  and the terminal diagnostics (§1).
- **Packaging:** `tools/projectpackager-windows` freezes `playtest.py` into
  `<Project>.exe` and packs `index.html` + `project.json` + `css/` + `js/` +
  `src/` into `<Project>.pak` beside it. Two profiles - *development*
  (console + diagnostics) and *shipping* (windowed) - see `tools/README.md`.
- **Window title:** taken from `project.json` `"title"`, falling back to the
  `<title>` in `index.html`.

---

## 8. Hello world

The shipped `js/story.js` is the worked example. The shape of it:

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
