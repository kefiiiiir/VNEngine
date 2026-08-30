# VNengine

A small, code-first visual novel engine. No build step, no framework, no
dependencies - four plain JavaScript files, one stylesheet, one HTML page.
You write your novel as a JavaScript array of "ops"; the engine plays it.

Think of it as the runtime, not the game: like an engine rather than a
finished title. The repository ships with a tiny demo so you can see every
feature working; replace `js/story.js` and `js/data.js` with your own.

---

## 1. Running it

**Option A - just open it.** Double-click `index.html`. Everything works
from `file://`, including saves (via `localStorage`).

**Option B - local server.** Some browsers restrict a few things on
`file://` (mainly decoding audio through the Web Audio graph). To avoid
that:

```bash
python playtest.py            # http://localhost:8000/index.html
python playtest.py 5500       # pick another port
```

`playtest.py` is a minimal static file server and nothing else. Set
`VN_NO_BROWSER=1` to stop it opening a tab. `Ctrl+C` stops it.

---

## 2. Project layout

```
index.html        screens + DOM the engine drives
css/style.css     all styling; theme via the CSS variables at the top
js/audio.js       music + sound engine  -> window.VNAudio   (self-contained, reusable)
js/data.js        your assets manifest  -> window.VNData     (EDIT THIS)
js/story.js       your script           -> window.VNScript   (EDIT THIS)
js/engine.js      the runtime           (usually left alone)
src/              your images and audio (see src/README.md)
```

Load order in `index.html` matters: `audio.js`, `data.js`, `story.js`,
then `engine.js`. Bump the `?v=` query on the `<script>`/`<link>` tags
when you change a file so the browser drops its cache.

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

| token     | becomes                     |
|-----------|-----------------------------|
| `{first}` | player first name           |
| `{last}`  | player last name            |
| `{name}`  | `"first last"` trimmed      |

The name comes from the built-in name-entry screen shown on **New game**.
Don't need it? Leave the fields blank - `{first}` falls back to `"Player"`.

### Stage

| op | signature | example |
|----|-----------|---------|
| `bg` | `bg(name)` | `bg('room')` - crossfades to a background from `VNData.BACKGROUNDS` (or a raw path) |
| `show` | `show(who, expr, pos)` | `show('ari', 'talk', 'left')` - `pos` is `'left'` \| `'center'` \| `'right'` |
| `hide` | `hide(who)` | `hide('ari')` |

The speaking character is auto-highlighted; the rest dim.

### Text

| op | signature | example |
|----|-----------|---------|
| `say` | `say(who, text, expr)` | `say('ari', 'Hi, {first}!', 'talk')` - `expr` also swaps the on-stage sprite |
| `narr` | `narr(text)` | `narr('The room is empty.')` - narration, no name box |
| `mc` | `mc(text)` | `mc('(What now?)')` - the player's own voice |

Text types out; a click / Space / Enter completes the line, the next
click advances. "Text speed" and "Fast-forward seen text" are in Settings.

### Flow

| op | signature | example |
|----|-----------|---------|
| `label` | `label(name)` | `label('act2')` - a jump target |
| `jump` | `jump(name)` | `jump('act2')` |
| `iff` | `iff(fn, name)` | `iff(function (s) { return s.vars.warmth > 0; }, 'good_end')` |
| `set` | `set(obj)` | `set({ warmth: 1, met_ari: true })` |
| `choice` | `choice(options)` | see below |

`set` with a **number** adds to the current value (starts at 0); any
other value is assigned. `iff`'s function receives the state object -
read `s.vars.*` and `s.player.*`.

```js
choice([
  { text: 'Say yes', to: 'yes_branch', set: { warmth: 1 } },
  { text: 'Say no',  to: 'no_branch' }
])
```

Each option: `text` (supports tokens), optional `to` (label), optional
`set`. Choices are also selectable with number keys `1`-`9`.

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
- A checkpoint stores: instruction pointer, `vars`, player name, the
  "seen" set (for fast-forward), and the stage (background + who is
  shown where). Up to 30 are kept; oldest non-chapter-end ones are
  dropped first.
- Everything lives in `localStorage` under `vnengine_save`,
  `vnengine_checkpoints`, `vnengine_settings`, `vnengine_audio`.
  **Erase save** on the title screen clears them.

---

## 6. Settings

| setting | what it does |
|---------|--------------|
| Text speed | typewriter rate |
| Music volume / Sound volume / Mute | audio levels (persist immediately) |
| Screen effects | gate for `fx('shake')` / `fx('flash')` |
| Fast-forward seen text | already-seen lines appear instantly |

---

## 7. Theming & notes

- **Colours / fonts:** the `:root` custom properties at the top of
  `css/style.css` (`--pink-*` accent ramp, `--ink*`, `--box-*`,
  `--font-*`). Change them there to reskin everything.
- **Port:** `DEFAULT_PORT` in `playtest.py`, or pass one as an argument.
- **`file://` vs server:** identical except audio decoding is more
  reliable over the server; the engine falls back to a plain `<audio>`
  element on `file://`.
- **Cache:** bump `?v=` in `index.html` after edits.

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
