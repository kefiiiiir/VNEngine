#!/usr/bin/env python3
"""
VNengine - project packager (Windows).

This lives inside your project (``<project>/tools/``). Run it from anywhere to
turn the project into a distributable folder - think of it as the "Build"
button:

    python tools/projectpackager-windows.py

Produces:

    <output>/<Project>/
        <Project>.exe     playtest.py frozen into one file
        index.html        copied as-is
        <Project>.pak      css/ + js/ + src/ zipped

The .exe is a tiny local server: on launch it finds the .pak next to it and
serves css/js/src straight out of it, so index.html never has to change.

Everything runs on the command line - no GUI at any point.
"""

import os
import re
import sys
import json
import shutil
import zipfile
import tempfile
import subprocess

ARCHIVE_DIRS = ("css", "js", "src")

# <project>/tools/this_file  ->  <project>
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


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


def check_deps():
    # The freezer backend. Bundled in the shipped .exe build of this tool;
    # when running this file as a plain script it must be importable.
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        sys.exit("packaging backend is not available in this environment.")


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


def build_exe(project_dir, name, console, work):
    """Run PyInstaller; return the path to the produced .exe."""
    dist = os.path.join(work, "dist")
    args = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm", "--clean", "--onefile",
        "--name", name,
        "--console" if console else "--windowed",
        "--distpath", dist,
        "--workpath", os.path.join(work, "build"),
        "--specpath", work,
    ]
    icon = os.path.join(project_dir, "icon.ico")
    if os.path.isfile(icon):
        args += ["--icon", icon]
    args.append(os.path.join(project_dir, "playtest.py"))

    print("\nBuilding %s.exe (onefile, %s) ...\n" %
          (name, "console" if console else "windowed"))
    rc = subprocess.call(args)
    if rc != 0:
        sys.exit("PyInstaller exited with code %d" % rc)

    exe = os.path.join(dist, name + ".exe")
    if not os.path.isfile(exe):
        sys.exit("build finished but %s was not found" % exe)
    return exe


def build_archive(project_dir, archive_path):
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
    if os.name != "nt":
        print("warning: this tool targets Windows; the build step needs Windows.\n")

    check_deps()
    print("VNengine - project packager\n")

    project_dir = PROJECT_DIR
    if not is_project(project_dir):
        print("(%s doesn't look like a project)" % project_dir)
        while not is_project(project_dir):
            project_dir = os.path.abspath(os.path.expanduser(
                ask("Path to the project folder")))
            if not is_project(project_dir):
                print("  -> needs both playtest.py and index.html; try again.\n")
    print("Project: %s" % project_dir)

    name = project_name(project_dir)
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", name).strip("_") or "game"

    build_type = ask_choice("Build type:", ["window based", "console based"],
                            "window based")
    console = build_type == "console based"

    ext = ask_choice("Archive format:", [".pak", ".zip"], ".pak")

    out_root = os.path.abspath(os.path.expanduser(
        ask("Output directory", os.path.join(project_dir, "dist"))))
    out_dir = os.path.join(out_root, safe)
    if os.path.isdir(out_dir) and os.listdir(out_dir):
        if not ask_yes("%s exists and is not empty. Overwrite?" % out_dir):
            sys.exit("cancelled.")
        shutil.rmtree(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    work = tempfile.mkdtemp(prefix="vnpack_")
    try:
        exe = build_exe(project_dir, safe, console, work)
        shutil.copy2(exe, os.path.join(out_dir, safe + ".exe"))
    finally:
        shutil.rmtree(work, ignore_errors=True)

    shutil.copy2(os.path.join(project_dir, "index.html"),
                 os.path.join(out_dir, "index.html"))
    build_archive(project_dir, os.path.join(out_dir, safe + ext))

    print("\nDone. %s" % out_dir)
    for fn in sorted(os.listdir(out_dir)):
        print("  %s" % fn)


if __name__ == "__main__":
    main()
