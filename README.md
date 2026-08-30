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

## Get started

**Download — the normal way.** Grab `VNEngine-Dist.zip` from the
[Releases](../../releases) page, extract it and run `setup.exe`.

**From source.** This repo is plain Python, open source. Same thing:

```bash
python setup.py
```

Either way, you answer a few prompts (name, title, author, where to put it) and
get a **project folder** — your own copy of the engine, ready to edit, like a
fresh Unity or Unreal project.

### Play it while you build

```bash
cd <YourProject>
playtest            # or:  python playtest.py   — opens http://localhost:8000
```

`playtest` runs a minimal local server so the browser stops complaining about
`file://`. Edit `js/story.js` and `js/data.js`, refresh, repeat. (You can also
just double-click `index.html`; the server only makes audio decoding a little
more reliable.)

### Ship a distributable

From the project folder, run the packager — `projectpackager-windows.exe`, in
`tools/`. Pick an archive format and an output folder; you get:

```
<output>/<Project>/
    <Project>.exe     the game — a self-contained local runtime
    index.html
    <Project>.pak     css + js + src, packed
```

Anyone double-clicks `<Project>.exe`: it starts the local runtime, reads the
assets straight out of the `.pak`, and opens the game in their browser. Nothing
to install on their side.

The first run freezes the runtime from your `playtest.py` (via
`tools/projectpackager-tools/`) and caches it; later runs reuse it and only
rebuild when `playtest.py` changes. After that it's just copy + zip.

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
tools/            the packager (the "Build" step) + everything it needs
VNengine.md       the full manual — every op, with examples
```

**Start with [`VNengine.md`](template/VNengine.md)** — it documents every
scripting op (`say`, `bg`, `show`, `choice`, `music`, `fx`, checkpoints, …)
with copy-paste examples.

---

## This repo

Open source. The repo holds the engine and its tooling in **Python + JS
source form**; the [Releases](../../releases) page publishes the compiled
`.exe` builds (`setup.exe`, and the packager that ships inside each project).

```
setup.py           scaffold a new project        (published as setup.exe)
template/          the engine — copied wholesale into every new project
  index.html  playtest.py  VNengine.md
  css/  js/  src/
  tools/
    projectpackager-windows.py    the "Build" step  (published as .exe, in-project)
    projectpackager-tools/
      build-runtime.py            freezes playtest.py into the game runtime
```

`template/` is the source of truth for the engine; you never run it in place —
`setup` a copy and work in that.
