#!/usr/bin/env python3
"""
VNengine - project packager (Windows).

Ships inside every project at ``<project>/tools/``. Run it from the project
root - the "Build" button:

    projectpackager-windows            (or: python tools/projectpackager-windows.py)

Produces a distributable folder:

    <output>/<Project>/
        <Project>.exe      the game runtime (playtest.py frozen)
        index.html         copied as-is
        <Project>.pak      css/ + js/ + src/, packed

On the first run (or whenever ``playtest.py`` changed) it freezes the runtime
via ``projectpackager-tools/build-runtime.py`` and caches it; after that it is
just copy + zip. Nothing is prebuilt and shipped - the runtime always matches
the current ``playtest.py``.

Everything this tool needs lives under ``tools/``:

    tools/
      projectpackager-windows(.py/.exe)
      projectpackager-tools/
        build-runtime.py       does the freezing
        cache/                 built runtime + a hash of playtest.py
"""

import os
import re
import sys
import json
import shutil
import hashlib
import subprocess

ARCHIVE_DIRS = ("css", "js", "src")

FROZEN = getattr(sys, "frozen", False)


def _self_dir():
    """Folder this program actually sits in.

    As a script: the folder of this file. Frozen into an .exe: the folder of
    the .exe - NOT ``__file__`` / ``sys._MEIPASS``, which point at a throwaway
    unpack dir under %TEMP%.
    """
    anchor = sys.executable if FROZEN else __file__
    return os.path.dirname(os.path.abspath(anchor))


PP_TOOLS = os.path.join(_self_dir(), "projectpackager-tools")
BUILD_RUNTIME = os.path.join(PP_TOOLS, "build-runtime.py")
CACHE_DIR = os.path.join(PP_TOOLS, "cache")
CACHED_EXE = os.path.join(CACHE_DIR, "runtime-windows.exe")
CACHED_SIG = os.path.join(CACHE_DIR, "playtest.sha256")


def ask(prompt, default=""):
    suffix = " [%s]" % default if default else ""
    try:
        val = input("%s%s: " % (prompt, suffix)).strip()
    except EOFError:
        sys.exit("\ncancelled: end of input.")
    return val or default


def ask_choice(prompt, options, default):
    print(prompt)
    for i, o in enumerate(options, 1):
        print("  %d) %s%s" % (i, o, "  (default)" if o == default else ""))
    raw = ask("Choose 1-%d" % len(options), str(options.index(default) + 1))
    try:
        return options[int(raw) - 1]
    except (ValueError, IndexError):
        return default


def ask_yes(prompt):
    try:
        return input("%s [y/N]: " % prompt).strip().lower() in ("y", "yes")
    except EOFError:
        return False


def project_name(project_dir):
    meta = os.path.join(project_dir, "project.json")
    if os.path.isfile(meta):
        try:
            with open(meta, encoding="utf-8") as f:
                n = json.load(f).get("name")
            if n:
                return n
        except (ValueError, OSError):
            pass
    return os.path.basename(os.path.normpath(project_dir))


def is_project(path):
    return (os.path.isfile(os.path.join(path, "playtest.py")) and
            os.path.isfile(os.path.join(path, "index.html")))


def find_project():
    """Locate the project folder, whatever the layout.

    Walks up from the current directory and from this program's own folder,
    returning the first ancestor that looks like a project. Handles: run from
    the project root, this tool sitting in <project>/tools/ (as a script, a
    onefile .exe, or a onedir .exe in its own subfolder), etc.
    """
    starts = [os.getcwd(), _self_dir()]
    if not FROZEN:
        starts.append(os.path.dirname(os.path.abspath(__file__)))
    seen = set()
    for start in starts:
        p = os.path.abspath(start)
        for _ in range(6):
            if p in seen:
                break
            seen.add(p)
            if is_project(p):
                return p
            parent = os.path.dirname(p)
            if parent == p:
                break
            p = parent
    return None


def _python():
    """An interpreter that can run build-runtime.py.

    As a script that's just us. Frozen, sys.executable is the packager .exe,
    so look for a real Python - bundled next to build-runtime.py first, then
    on PATH.
    """
    if not FROZEN:
        return sys.executable
    local = os.path.join(PP_TOOLS, "python", "python.exe")
    if os.path.isfile(local):
        return local
    return shutil.which("python") or shutil.which("py")


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure_runtime(project_dir):
    """Return a runtime .exe built from this project's playtest.py.

    Cached under projectpackager-tools/cache/ and rebuilt only when
    playtest.py changed."""
    playtest = os.path.join(project_dir, "playtest.py")
    sig = _sha256(playtest)

    if os.path.isfile(CACHED_EXE) and os.path.isfile(CACHED_SIG):
        try:
            with open(CACHED_SIG) as f:
                if f.read().strip() == sig:
                    print("Runtime: cached (playtest.py unchanged)")
                    return CACHED_EXE
        except OSError:
            pass

    if not os.path.isfile(BUILD_RUNTIME):
        sys.exit("missing: %s" % BUILD_RUNTIME)
    py = _python()
    if not py:
        sys.exit("no Python found to build the runtime - put one at\n"
                 "  %s\n" % os.path.join(PP_TOOLS, "python", "python.exe"))

    print("Runtime: building from playtest.py ...\n")
    os.makedirs(CACHE_DIR, exist_ok=True)
    rc = subprocess.call([py, BUILD_RUNTIME, playtest, CACHE_DIR])
    if rc != 0 or not os.path.isfile(CACHED_EXE):
        sys.exit("runtime build failed")
    with open(CACHED_SIG, "w") as f:
        f.write(sig)
    return CACHED_EXE


def build_archive(project_dir, archive_path):
    import zipfile
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for d in ARCHIVE_DIRS:
            src = os.path.join(project_dir, d)
            if not os.path.isdir(src):
                continue
            for dirpath, _, files in os.walk(src):
                for fn in files:
                    full = os.path.join(dirpath, fn)
                    rel = os.path.relpath(full, project_dir).replace("\\", "/")
                    zf.write(full, rel)


def main():
    print("VNengine - project packager\n")

    project_dir = find_project()
    if project_dir is None:
        print("(couldn't find a project automatically)")
        while project_dir is None or not is_project(project_dir):
            project_dir = os.path.abspath(os.path.expanduser(
                ask("Path to the project folder")))
            if not is_project(project_dir):
                print("  -> needs both playtest.py and index.html; try again.\n")
    print("Project: %s" % project_dir)

    name = project_name(project_dir)
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", name).strip("_") or "game"

    ext = ask_choice("Archive format:", [".pak", ".zip"], ".pak")

    out_root = os.path.abspath(os.path.expanduser(
        ask("Output directory", os.path.join(project_dir, "dist"))))
    out_dir = os.path.join(out_root, safe)
    if os.path.isdir(out_dir) and os.listdir(out_dir):
        if not ask_yes("%s exists and is not empty. Overwrite?" % out_dir):
            sys.exit("cancelled.")
        shutil.rmtree(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    runtime = ensure_runtime(project_dir)

    shutil.copy2(runtime, os.path.join(out_dir, safe + ".exe"))
    shutil.copy2(os.path.join(project_dir, "index.html"),
                 os.path.join(out_dir, "index.html"))
    build_archive(project_dir, os.path.join(out_dir, safe + ext))

    print("\nDone. %s" % out_dir)
    for fn in sorted(os.listdir(out_dir)):
        print("  %s" % fn)


if __name__ == "__main__":
    main()
