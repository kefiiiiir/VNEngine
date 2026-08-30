#!/usr/bin/env python3
"""
VNengine - new project scaffolder.

Interactive:

    python setup.py

Asks for a project name, title, author and a destination folder, then copies
the engine template into  <destination>/<ProjectName>/  ready to run with
``python playtest.py``.

Later this file is meant to be frozen into a single setup.exe; the template is
then bundled with PyInstaller ``--add-data`` and found via ``sys._MEIPASS``.
The ``_template_dir()`` helper already handles both cases.
"""

import os
import re
import sys
import json
import shutil
import datetime

VALID_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$")


def _template_dir():
    """Folder holding the engine template, frozen or not."""
    if getattr(sys, "frozen", False):
        base = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, "template")


def ask(prompt, default=""):
    suffix = " [%s]" % default if default else ""
    try:
        val = input("%s%s: " % (prompt, suffix)).strip()
    except EOFError:
        sys.exit("\ncancelled: end of input.")
    return val or default


def ask_yes(prompt):
    try:
        return input("%s [y/N]: " % prompt).strip().lower() in ("y", "yes")
    except EOFError:
        return False


def patch_title(index_html, title):
    with open(index_html, "r", encoding="utf-8") as f:
        html = f.read()
    html = re.sub(r"<title>.*?</title>",
                  "<title>%s</title>" % title, html, count=1, flags=re.S)
    with open(index_html, "w", encoding="utf-8") as f:
        f.write(html)


def main():
    template = _template_dir()
    if not os.path.isdir(template):
        sys.exit("error: template folder not found at %s" % template)

    print("VNengine - new project\n")

    name = ""
    while not VALID_NAME.match(name):
        name = ask("Project name (letters, digits, space, _ or -)")
        if not VALID_NAME.match(name):
            print("  -> 1-64 chars, must start with a letter or digit.")
    name = name.strip()

    title = ask("Display title (browser tab)", name)
    author = ask("Author (optional)")
    dest_root = ask("Destination folder", os.getcwd())

    dest = os.path.abspath(os.path.join(os.path.expanduser(dest_root), name))
    if os.path.isdir(dest) and os.listdir(dest):
        if not ask_yes("%s exists and is not empty. Overwrite its contents?" % dest):
            sys.exit("cancelled.")
        shutil.rmtree(dest)

    shutil.copytree(template, dest, dirs_exist_ok=True)

    index_html = os.path.join(dest, "index.html")
    if os.path.isfile(index_html):
        patch_title(index_html, title)

    with open(os.path.join(dest, "project.json"), "w", encoding="utf-8") as f:
        json.dump({
            "name": name,
            "title": title,
            "author": author,
            "engine": "VNengine",
            "created": datetime.date.today().isoformat(),
        }, f, indent=2)
        f.write("\n")

    print("\nCreated %s" % dest)
    print("\nNext:")
    print("  cd %s" % dest)
    print("  python playtest.py                      # play it")
    print("  python tools/projectpackager-windows.py # build it")


if __name__ == "__main__":
    main()
