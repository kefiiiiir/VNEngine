# VNengine SDK

A small, code-first visual novel engine plus the tooling to start and ship
projects with it. The engine manual lives in
[`template/VNengine.md`](template/VNengine.md).

## Lifecycle

**1. Scaffold a project**

```bash
python setup.py
```

Asks for a name / title / author / destination and copies the engine template
into `<destination>/<ProjectName>/`.

**2. Playtest it**

```bash
cd <destination>/<ProjectName>
python playtest.py            # http://localhost:8000/index.html
```

`playtest.py` is a minimal local server. With no archive beside it, it serves
the folder straight from disk - this is dev mode.

**3. Package it for distribution**

```bash
python tools/projectpackager-windows.py
```

Point it at the project folder. It produces:

```
<output>/<Project>/
    <Project>.exe     playtest.py frozen (onefile) via auto-py-to-exe
    index.html        copied unchanged
    <Project>.pak      css/ + js/ + src/ zipped (.zip also offered)
```

Double-clicking `<Project>.exe` starts the same server; it finds the `.pak`
next to it and serves `css/js/src` out of the archive while `index.html` is
read from disk. Needs `pip install auto-py-to-exe`.

## Repo layout

```
setup.py                       scaffold a new project
tools/
  projectpackager-windows.py   package a project for distribution
template/                      the engine, copied into every new project
  index.html
  playtest.py                  dev server + packaged runtime
  css/  js/  src/
  VNengine.md                  the engine manual
```
