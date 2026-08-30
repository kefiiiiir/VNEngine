#!/usr/bin/env python3
"""
VNengine tool - projectpackager (Windows).

Turns a project folder (made by setup.py) into a distributable folder:

    <output>/<Project>/
        <Project>.exe     playtest.py frozen with PyInstaller (onefile)
        index.html        copied as-is
        <Project>.pak      css/ + js/ + src/ zipped

The .exe is a tiny local server: on launch it finds the .pak next to it and
serves css/js/src straight out of it, so index.html never has to change.

Build is driven through auto-py-to-exe in headless CLI mode (`-c config.json
-o out`) - its GUI is never opened.

    python tools/projectpackager-windows.py

Requires:  pip install auto-py-to-exe
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


def ask(prompt, default=""):
    suffix = " [%s]" % default if default else ""
    try:
        val = input("%s%s: " % (prompt, suffix)).strip()
    except EOFError:
        val = ""
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
    try:
        import auto_py_to_exe  # noqa: F401
    except ImportError:
        sys.exit("auto-py-to-exe is not installed.\n  pip install auto-py-to-exe")
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        sys.exit("PyInstaller is not installed.\n  pip install auto-py-to-exe")


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


def write_config(cfg_path, script, name, console, icon):
    opts = [
        {"optionDest": "noconfirm", "value": True, "enabled": True},
        {"optionDest": "filenames", "value": script, "enabled": True},
        {"optionDest": "onefile", "value": True, "enabled": True},
        {"optionDest": "console", "value": bool(console), "enabled": True},
        {"optionDest": "name", "value": name, "enabled": True},
    ]
    if icon:
        opts.append({"optionDest": "icon_file", "value": icon, "enabled": True})
    with open(cfg_path, "w", encoding="utf-8") as f:
        json.dump({
            "version": "auto-py-to-exe-configuration_v1",
            "pyinstallerOptions": opts,
            "nonPyinstallerOptions": {
                "increaseRecursionLimit": True,
                "manualArguments": "",
            },
        }, f, indent=2)


def find_exe(root, name):
    target = name.lower() + ".exe"
    for dirpath, _, files in os.walk(root):
        for fn in files:
            if fn.lower() == target:
                return os.path.join(dirpath, fn)
    return None


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

    project_dir = ""
    while True:
        project_dir = os.path.abspath(os.path.expanduser(
            ask("Path to the project folder", os.getcwd())))
        ok = (os.path.isfile(os.path.join(project_dir, "playtest.py")) and
              os.path.isfile(os.path.join(project_dir, "index.html")))
        if ok:
            break
        print("  -> needs both playtest.py and index.html; try again.\n")

    name = project_name(project_dir)
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", name).strip("_") or "game"

    build_type = ask_choice("Build type:", ["window based", "console based"],
                            "window based")
    console = build_type == "console based"

    ext = ask_choice("Archive format:", [".pak", ".zip"], ".pak")

    out_root = os.path.abspath(os.path.expanduser(
        ask("Output directory", os.getcwd())))
    out_dir = os.path.join(out_root, safe)
    if os.path.isdir(out_dir) and os.listdir(out_dir):
        if not ask_yes("%s exists and is not empty. Overwrite?" % out_dir):
            sys.exit("cancelled.")
        shutil.rmtree(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    icon = os.path.join(project_dir, "icon.ico")
    icon = icon if os.path.isfile(icon) else ""

    work = tempfile.mkdtemp(prefix="vnpack_")
    try:
        cfg = os.path.join(work, "config.json")
        apte_out = os.path.join(work, "dist")
        write_config(cfg, os.path.join(project_dir, "playtest.py"),
                     safe, console, icon)

        print("\nBuilding %s.exe (%s, onefile) ...\n" % (safe, build_type))
        rc = subprocess.call([sys.executable, "-m", "auto_py_to_exe",
                              "-c", cfg, "-o", apte_out])
        if rc != 0:
            sys.exit("auto-py-to-exe exited with code %d" % rc)

        exe = find_exe(apte_out, safe)
        if not exe:
            sys.exit("build finished but %s.exe was not found under %s" %
                     (safe, apte_out))
        shutil.copy2(exe, os.path.join(out_dir, safe + ".exe"))
    finally:
        shutil.rmtree(work, ignore_errors=True)
        for stray in (safe + ".spec",):
            if os.path.isfile(stray):
                os.remove(stray)
        if os.path.isdir("build"):
            shutil.rmtree("build", ignore_errors=True)

    shutil.copy2(os.path.join(project_dir, "index.html"),
                 os.path.join(out_dir, "index.html"))
    build_archive(project_dir, os.path.join(out_dir, safe + ext))

    print("\nDone. %s" % out_dir)
    for fn in sorted(os.listdir(out_dir)):
        print("  %s" % fn)


if __name__ == "__main__":
    main()
