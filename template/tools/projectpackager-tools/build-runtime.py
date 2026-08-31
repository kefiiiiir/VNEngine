#!/usr/bin/env python3
"""
Freeze a script into a single-file .exe.

Helper for ../projectpackager-windows: it calls this to turn the project's
``playtest.py`` into the game runtime that becomes ``<Project>.exe``. Kept as
a separate script on purpose - the packager can then be a plain .exe and just
hand the actual freezing off to here (a frozen program can't run the freezer
on itself).

    python build-runtime.py <script.py> <out_dir> [--windowed]

Writes ``<out_dir>/runtime-windows.exe`` and prints its path. Needs PyInstaller
(``pip install pyinstaller``); this is the only place it is used.

The runtime opens the game in a native window via pywebview
(``pip install pywebview``), so pywebview and its Windows WebView2 backend
(pythonnet / clr_loader) are collected into the freeze. A development
(``--console``) build also bundles ``tools/devlog.js`` next to the exe so the
frozen server can inject its console bridge; a shipping build has no console
and never serves it.
"""

import os
import sys
import shutil
import tempfile
import subprocess


def build(script, out_dir, windowed=False):
    script = os.path.abspath(script)
    if not os.path.isfile(script):
        raise SystemExit("not found: %s" % script)
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        raise SystemExit("PyInstaller is required to build the runtime:\n"
                         "  pip install pyinstaller")

    os.makedirs(out_dir, exist_ok=True)
    work = tempfile.mkdtemp(prefix="vnrt_")

    # pywebview: pull the package + its Windows backend deps into the freeze.
    extra = [
        "--collect-all", "webview",
        "--hidden-import", "webview.platforms.winforms",
        "--hidden-import", "clr_loader",
        "--hidden-import", "pythonnet",
    ]
    # devlog.js ships beside the exe for --console builds only.
    devlog = os.path.join(os.path.dirname(script), "tools", "devlog.js")
    if not windowed and os.path.isfile(devlog):
        extra += ["--add-data", devlog + os.pathsep + "."]

    try:
        rc = subprocess.call([
            sys.executable, "-m", "PyInstaller",
            "--noconfirm", "--clean", "--onefile",
            "--name", "runtime-windows",
            "--windowed" if windowed else "--console",
            *extra,
            "--distpath", os.path.join(work, "dist"),
            "--workpath", os.path.join(work, "build"),
            "--specpath", work,
            script,
        ])
        if rc != 0:
            raise SystemExit("PyInstaller exited with code %d" % rc)
        built = os.path.join(work, "dist", "runtime-windows.exe")
        if not os.path.isfile(built):
            raise SystemExit("build finished but no exe was produced")
        dest = os.path.join(out_dir, "runtime-windows.exe")
        shutil.copy2(built, dest)
        return dest
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main(argv):
    positional = [a for a in argv if not a.startswith("--")]
    windowed = "--windowed" in argv
    if len(positional) != 2:
        raise SystemExit("usage: build-runtime.py <script.py> <out_dir> [--windowed]")
    print(build(positional[0], positional[1], windowed))


if __name__ == "__main__":
    main(sys.argv[1:])
