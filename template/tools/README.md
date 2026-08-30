# tools/

Everything the project's "Build" step needs, and nothing else, lives here.

```
projectpackager-windows(.py/.exe)   run this from the project root
projectpackager-tools/
  build-runtime.py                  freezes playtest.py -> a runtime .exe
  cache/                            the built runtime + a hash of playtest.py
                                    (rebuilt only when playtest.py changes)
```

`projectpackager-windows` finds the project, makes sure a current runtime
exists (building it through `build-runtime.py` the first time, or after you
edit `playtest.py`), then assembles `<output>/<Project>/`:

```
<Project>.exe     the cached runtime, renamed
index.html        copied as-is
<Project>.pak     css/ + js/ + src/, packed
```

`<Project>.exe` starts a tiny local server that finds the `.pak` next to it
and serves the game from it. Nothing to install for whoever runs it.
