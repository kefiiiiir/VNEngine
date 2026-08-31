# tools/

Everything the project's "Build" step needs, and nothing else, lives here.

```
projectpackager-windows(.py/.exe)   run this from the project root
devlog.js                           dev-only browser -> terminal console bridge
projectpackager-tools/
  build-runtime.py                  freezes playtest.py -> a runtime .exe
  cache/                            built runtimes (per profile) + playtest hashes
                                    (rebuilt only when playtest.py changes)
```

`projectpackager-windows` finds the project, picks a **build profile**,
makes sure a current runtime for that profile exists (building it through
`build-runtime.py` the first time, or after you edit `playtest.py`), then
assembles `<output>/<Project>/`:

```
<Project>.exe     the cached runtime, renamed
<Project>.pak     index.html + project.json + css/ + js/ + src/, packed
```

`index.html` is now packed **inside** the `.pak` - there's no loose file
next to the `.exe` for a player to edit. `project.json` rides along so the
runtime can title its window with the project's real name instead of a
generic "VNengine". `<Project>.exe` starts a tiny
local server that finds the `.pak` beside it, serves the game out of it in
a native window, and shuts down when that window closes. Nothing to
install for whoever runs it.

## Build profiles

| profile | runtime | for |
|---|---|---|
| **development** | `--console` | your own testing - a console window opens alongside the game and streams the browser diagnostics (via `devlog.js`, bundled into this build) |
| **shipping** | `--windowed` | release - no console, no `devlog.js`, `index.html` served untouched |

Each profile has its own cache slot (`runtime-windows-{dev,ship}.exe` +
`playtest-{dev,ship}.sha256`), so switching profiles doesn't force a
rebuild of the other one.

## devlog.js

A ~60-line, dependency-free client shim. It is **never referenced by
`index.html`** and **never reaches a shipping build**. `playtest.py`
injects a `<script>` tag for it on the fly, only when it has a console to
print to, and serves it from `/__vn/devlog.js`. It wraps `console.*` and
hooks `error` / `unhandledrejection`, then POSTs batches to `/__vn/log`,
where `playtest.py` prints them. The original `console` methods still run,
so F12 works normally too.

## Prerequisites

```
pip install pyinstaller pywebview
```

The frozen runtime opens its window via `pywebview` (WebView2 on Windows);
`build-runtime.py` collects it and its `pythonnet` / `clr_loader` backend
into the freeze. If the bundle ever comes up short at runtime, the exe
still falls back to opening the default browser.
