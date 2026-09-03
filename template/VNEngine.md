# VNEngine

A small, code-first visual novel engine. No build step, no framework - four
plain JavaScript files, one stylesheet, one HTML page, and the engine itself
pulls in nothing. You write your novel as a JavaScript array of "ops"; the
engine plays it.

Think of it as the runtime, not the game: like an engine rather than a
finished title. The repository ships with a tiny demo so you can see every
feature working; replace `js/story/` (see
[`js/story/README.md`](js/story/README.md)) and `js/data.js` with your own.

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
js/story/         your script - see js/story/README.md       (EDIT THIS)
  chapter1.js       chapter 1 -> window.VNScript
  chapter2.js       chapter 2 -> window.VNScript  (add more chapterN.js as needed)
  story-helpers.js  op builders (say, bg, show, ...) shared by every chapter file
js/save-resolve.js  save/position hashing + resolution (usually left alone)
js/engine.js      the runtime           (usually left alone)
src/              your images and audio (see src/README.md)
playtest.py       the local server + native-window launcher
project.json      name / title / author  (setup writes it; titles the window)
tools/            the packager - the "Build" step (see tools/README.md)
```

Load order in `index.html` matters: `audio.js`, `data.js`, `story-helpers.js`,
then every `chapterN.js` in story order, then `save-resolve.js`, then
`engine.js`. Fonts are bundled in `src/fonts/` and `@font-face`d in
`style.css` - nothing is fetched from the network.

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

## 4. Scripting - `js/story/` (`VNScript`)

A script is `{ ops: [ ... ] }`. The engine walks the array from the top,
moving the instruction pointer; `label` / `jump` / `if` / `choice` redirect
it. Your novel lives in `js/story/` - one file per chapter
(`chapter1.js`, `chapter2.js`, ...) plus the shared op builders in
`story-helpers.js`.

**See [`js/story/README.md`](js/story/README.md) for the full guide** -
how the chapter-file split works, and the complete op reference (text
tokens/markup, stage, text, flow, audio, `fx`, `PlayTestLog`,
persistence).

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

For a worked "hello world" example, see
[`js/story/README.md`](js/story/README.md#1-adding-and-editing-chapters).
