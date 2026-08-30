# VNengine

A small, **code-first visual novel engine**. No build step, no framework, no
dependencies — four plain JavaScript files, one stylesheet, one HTML page. You
write your novel as a JavaScript array of "ops"; the engine plays it.

It's the runtime, not the game — like an engine rather than a finished title.
Every project starts as a copy of the engine plus a tiny worked demo, so you
can see every feature running, then replace the demo with your own script.

```js
label('start'),
music('theme', { volume: 0.5, fade: 2 }),
bg('room'),
show('ari', 'idle', 'left'),
say('ari', 'Hi, {first}!', 'talk'),
choice([
  { text: 'Of course',  to: 'yes', set: { warmth: 1 } },
  { text: "Let's see",  to: 'no' }
]),
```

Features: typewriter text with tokens (`{first}`/`{last}`/`{name}`), background
crossfades, expression sprites with graceful placeholder fallback, branching
(`label`/`jump`/`if`/`choice`) and variables, a synthesized sound-effect
palette plus music with crossfade/duck/lo-fi, screen shake & flash, an
auto-save + named checkpoints system, a settings overlay, and a name-entry
screen — all in `localStorage`, all reskinnable from the CSS variables at the
top of `css/style.css`.

---

## Quick start

You need **Python 3** and a modern browser. Nothing else.

### 1. Create a project

```bash
python setup.py
```

Answer a few prompts (name, title, author, where to put it). This copies the
engine into `<destination>/<ProjectName>/` — your own project folder, ready to
edit, like a fresh Unity or Unreal project.

### 2. Play it while you build

```bash
cd <destination>/<ProjectName>
python playtest.py            # opens http://localhost:8000/index.html
```

`playtest.py` is a minimal local server — it just serves the folder so the
browser stops complaining about `file://`. Edit `js/story.js` and `js/data.js`,
refresh, repeat. (You can also just double-click `index.html`; the server only
makes audio decoding a little more reliable.)

### 3. Build a distributable

From the project folder:

```bash
python tools/projectpackager-windows.py
```

Pick console- or window-based, pick `.pak` or `.zip`, pick an output folder.
You get:

```
<output>/<Project>/
    <Project>.exe     the game — a self-contained local runtime
    index.html
    <Project>.pak     css + js + src, packed
```

Anyone double-clicks `<Project>.exe`: it starts the local runtime, reads the
assets straight out of the `.pak`, and opens the game in their browser. No
Python, no install, nothing to set up on their side.

---

## What you edit

```
index.html        screens + the DOM the engine drives
css/style.css     all styling; theme via the :root variables at the top
js/data.js        your assets manifest  -> window.VNData    (EDIT THIS)
js/story.js       your script           -> window.VNScript  (EDIT THIS)
js/audio.js       music + sound engine  -> window.VNAudio   (reusable as-is)
js/engine.js      the runtime           (usually left alone)
src/              your images and audio
tools/            the packager (step 3)
VNengine.md       the full manual — every op, with examples
```

**Start with [`VNengine.md`](template/VNengine.md)** — it documents every
scripting op (`say`, `bg`, `show`, `choice`, `music`, `fx`, checkpoints, …)
with copy-paste examples.

---

## Repo layout

```
setup.py       scaffold a new project (step 1)
template/      the engine — copied wholesale into every new project
  index.html  playtest.py  VNengine.md
  css/  js/  src/
  tools/projectpackager-windows.py
```

`template/` is the source of truth for the engine; you never run it in place,
you `setup.py` a copy and work in that.
