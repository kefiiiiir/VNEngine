#!/usr/bin/env python3
"""
VNengine - new project scaffolder.

Interactive:

    python setup.py

Asks for a project name, title, author and a destination folder, then copies
the engine template into  <destination>/<ProjectName>/  ready to run with
``python playtest.py``. It also offers to ``pip install`` the two Python
packages a project needs - ``pywebview`` (playtest window) and
``pyinstaller`` (packager) - so a fresh project runs and builds out of the
box.

Later this file is meant to be frozen into a single setup.exe; the template is
The release keeps ``template/`` as a real folder next to ``setup.exe`` (so it
stays visible and editable), so the frozen build just looks beside the .exe.
``_template_dir()`` handles every layout.
"""

import os
import re
import sys
import json
import time
import shutil
import datetime
import itertools
import threading
import subprocess

VALID_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$")


# --------------------------------------------------------------------------- #
#  tiny terminal UI - pure stdlib, safe to freeze, degrades to plain text     #
# --------------------------------------------------------------------------- #

try:                                    # box glyphs need a utf-8 stream
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def _enable_vt():
    """Turn on ANSI escape handling on the Windows console. No-op elsewhere."""
    if os.name != "nt":
        return True
    try:
        import ctypes
        k = ctypes.windll.kernel32
        touched = False
        for h in (-11, -12):            # STD_OUTPUT_HANDLE, STD_ERROR_HANDLE
            handle = k.GetStdHandle(h)
            if not handle or handle == -1:
                continue
            mode = ctypes.c_ulong()
            if not k.GetConsoleMode(handle, ctypes.byref(mode)):
                continue
            k.SetConsoleMode(handle, mode.value | 0x0004)  # VT processing
            touched = True
        return touched
    except Exception:
        return False


def _colors_ok():
    if os.environ.get("NO_COLOR") or os.environ.get("VNENGINE_PLAIN"):
        return False
    if not sys.stdout.isatty():
        return False
    return _enable_vt()


COLOR = _colors_ok()
ANIM = COLOR
UTF = "utf" in (getattr(sys.stdout, "encoding", "") or "").lower()

G = {
    "tl": "┌", "bl": "└", "bar": "│",
    "act": "◆", "done": "◇", "tick": "✔", "cross": "✖",
    "dot": "•", "arrow": "→",
} if UTF else {
    "tl": "+", "bl": "+", "bar": "|",
    "act": ">", "done": "*", "tick": "OK", "cross": "xx",
    "dot": "-", "arrow": "->",
}
_SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏" if UTF else "|/-\\"


def _sgr(s, code):
    return s if not COLOR else "\033[%sm%s\033[0m" % (code, s)


def bold(s):   return _sgr(s, "1")
def dim(s):    return _sgr(s, "2")
def cyan(s):   return _sgr(s, "38;5;44")
def green(s):  return _sgr(s, "38;5;42")
def red(s):    return _sgr(s, "38;5;203")
def yellow(s): return _sgr(s, "38;5;179")
def amber(s):  return _sgr(s, "38;5;215")


def grad(s, a=(0x33, 0xC8, 0xFF), b=(0x8B, 0x5C, 0xF6)):
    """Per-character truecolor gradient; plain when colour is off."""
    if not COLOR:
        return s
    n = max(len(s) - 1, 1)
    out = []
    for i, ch in enumerate(s):
        r = round(a[0] + (b[0] - a[0]) * i / n)
        g = round(a[1] + (b[1] - a[1]) * i / n)
        bl = round(a[2] + (b[2] - a[2]) * i / n)
        out.append("\033[38;2;%d;%d;%dm%s" % (r, g, bl, ch))
    return "".join(out) + "\033[0m"


def bar(s=""):
    print("%s  %s" % (dim(G["bar"]), s) if s else dim(G["bar"]))


def header(title, subtitle=""):
    print()
    print("%s  %s" % (dim(G["tl"]), bold(grad(" " + title + " "))))
    if subtitle:
        bar(dim(subtitle))
    bar()


def ok(s):    bar("%s  %s" % (green(G["tick"]), s))
def warn(s):  bar("%s  %s" % (yellow("!"), dim(s)))
def note(s):  bar(dim(s))


def die(msg):
    print()
    print("%s  %s  %s" % (dim(G["bl"]), red("error"), msg))
    sys.exit(1)


def _read(tail):
    try:
        return input("%s  %s" % (dim(G["bar"]), tail)).strip()
    except EOFError:
        die("end of input")
    except KeyboardInterrupt:
        die("cancelled")


def ask(prompt, default=""):
    suffix = "  " + dim("(%s)" % default) if default else ""
    print("%s  %s%s" % (cyan(G["act"]), bold(prompt), suffix))
    val = _read("")
    bar()
    return val or default


def ask_yes(prompt, default=False):
    tag = "[Y/n]" if default else "[y/N]"
    print("%s  %s  %s" % (cyan(G["act"]), bold(prompt), dim(tag)))
    try:
        ans = input("%s  " % dim(G["bar"])).strip().lower()
    except (EOFError, KeyboardInterrupt):
        ans = ""
    bar()
    if not ans:
        return default
    return ans in ("y", "yes")


class Spinner:
    """`with Spinner("msg"):` - animated while the block runs, ticked when done."""

    def __init__(self, msg):
        self.msg = msg
        self._stop = threading.Event()
        self._t = None

    def __enter__(self):
        if ANIM:
            self._t = threading.Thread(target=self._loop, daemon=True)
            self._t.start()
        else:
            bar("%s  %s ..." % (dim(G["dot"]), self.msg))
        return self

    def _loop(self):
        for ch in itertools.cycle(_SPIN):
            if self._stop.is_set():
                break
            try:
                sys.stdout.write("\r%s  %s  %s " %
                                 (dim(G["bar"]), cyan(ch), self.msg))
                sys.stdout.flush()
            except Exception:
                return
            time.sleep(0.08)

    def __exit__(self, et, ev, tb):
        if self._t:
            self._stop.set()
            self._t.join()
            sys.stdout.write("\r\033[K")
            sys.stdout.flush()
        mark = green(G["tick"]) if et is None else red(G["cross"])
        bar("%s  %s" % (mark, self.msg))
        return False


def outro(title, steps):
    bar()
    print("%s  %s" % (dim(G["bl"]), green(title)))
    for s in steps:
        print("   %s %s" % (dim(G["arrow"]), s))
    print()


# --- post-create "what now?" menu ------------------------------------------ #

def _getkey():
    """One keypress, unbuffered. Returns a token: ENTER / LF / ESC / CTRL_C /
    OTHER, or the lowercased character."""
    if os.name == "nt":
        import msvcrt
        ch = msvcrt.getwch()
        if ch == "\x03":
            return "CTRL_C"
        if ch == "\x1b":
            return "ESC"
        if ch == "\r":
            return "ENTER"
        if ch == "\n":                  # Ctrl+Enter on the Windows console
            return "LF"
        if ch in ("\x00", "\xe0"):      # arrow / function key - eat scancode
            msvcrt.getwch()
            return "OTHER"
        return ch.lower()
    try:
        import termios
        import tty
        fd = sys.stdin.fileno()
        old = termios.tcgetattr(fd)
        try:
            tty.setraw(fd)
            ch = sys.stdin.read(1)
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, old)
    except Exception:
        return "OTHER"
    if ch == "\x03":
        return "CTRL_C"
    if ch == "\x1b":
        return "ESC"
    if ch in ("\r", "\n"):
        return "ENTER"
    return ch.lower()


def _vscode_cmd():
    """Path to the VS Code CLI if it's installed, else None."""
    for c in ("code", "code.cmd", "code-insiders", "code-insiders.cmd"):
        p = shutil.which(c)
        if p:
            return p
    if os.name == "nt":
        for base in filter(None, (os.environ.get("LOCALAPPDATA"),
                                  os.environ.get("ProgramFiles"),
                                  os.environ.get("ProgramFiles(x86)"))):
            for sub in (("Programs", "Microsoft VS Code", "bin", "code.cmd"),
                        ("Microsoft VS Code", "bin", "code.cmd")):
                cand = os.path.join(base, *sub)
                if os.path.isfile(cand):
                    return cand
    return None


def _open_explorer(path):
    try:
        if os.name == "nt":
            os.startfile(path)                       # noqa: S606
        elif sys.platform == "darwin":
            subprocess.Popen(["open", path])
        else:
            subprocess.Popen(["xdg-open", path])
        return True
    except Exception:
        return False


def _open_vscode(cmd, folder, first_file=None):
    """Open the project folder in VS Code, and (if given) a file to land on."""
    args = [folder]
    if first_file and os.path.isfile(first_file):
        # -g so the tab is focused; folder-first makes it the workspace root
        args += ["-g", first_file]
    try:
        if os.name == "nt" and cmd.lower().endswith((".cmd", ".bat")):
            subprocess.Popen(["cmd", "/c", cmd, *args])
        else:
            subprocess.Popen([cmd, *args])
        return True
    except Exception:
        return False


def post_create_menu(dest):
    """Wait after a successful scaffold: Enter -> Explorer, Ctrl+Enter -> VS
    Code, Esc -> just close. Skipped when there's no interactive terminal."""
    if not (sys.stdin.isatty() and sys.stdout.isatty()):
        return

    vscode = _vscode_cmd()
    vskey = cyan("Ctrl+Enter") if os.name == "nt" else cyan("V")
    hint = [cyan("Enter") + dim(" open in Explorer")]
    if vscode:
        hint.append(vskey + dim(" open in VS Code"))
    hint.append(cyan("Esc") + dim(" close"))
    bar("   ".join(hint))
    bar()

    try:
        while True:
            key = _getkey()
            if key == "CTRL_C":
                raise KeyboardInterrupt
            if key in ("ESC", "q"):
                return
            if key in ("ENTER", "e", "o"):
                _open_explorer(dest)
                bar("%s  opening Explorer" % green(G["tick"]))
                return
            if vscode and key in ("LF", "v"):
                _open_vscode(vscode, dest, os.path.join(dest, "VNengine.md"))
                bar("%s  opening VS Code" % green(G["tick"]))
                return
            # anything else: keep waiting
    except KeyboardInterrupt:
        print()
        return


# --------------------------------------------------------------------------- #


def _template_candidates():
    """Places 'template/' might be, most-preferred first."""
    bases = []
    if getattr(sys, "frozen", False):
        # setup.exe: template/ ships as a real folder beside the .exe ...
        bases.append(os.path.dirname(os.path.abspath(sys.executable)))
        # ... or, if a build bundles it in with --add-data, under _MEIPASS.
        if getattr(sys, "_MEIPASS", None):
            bases.append(sys._MEIPASS)
    else:
        # running straight from the repo
        bases.append(os.path.dirname(os.path.abspath(__file__)))
    return [os.path.join(b, "template") for b in bases]


def _template_dir():
    for path in _template_candidates():
        if os.path.isdir(path):
            return path
    return None


def _esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def patch_index(index_html, title, author):
    """Rewrite <title>, the title-screen logo block and the credit line so a
    fresh project stops looking like the engine demo."""
    with open(index_html, "r", encoding="utf-8") as f:
        html = f.read()

    def sub1(pattern, replacement):
        # function replacement -> no backreference interpretation on user text
        return re.sub(pattern, lambda m: replacement, html, count=1, flags=re.S)

    html = sub1(r"<title>.*?</title>", "<title>%s</title>" % _esc(title))

    parts = title.split(" ", 1)
    span_a = _esc(parts[0])
    span_b = _esc(parts[1]) if len(parts) > 1 else ""
    sub = _esc(author) if author else _esc(title)
    logo = '<span class="logo-a">%s</span>' % span_a
    if span_b:
        logo += '\n        <span class="logo-b">%s</span>' % span_b
    logo += '\n        <span class="logo-sub">%s</span>' % sub
    html = sub1(
        r"<!-- LOGO:start.*?-->.*?<!-- LOGO:end -->",
        '<!-- LOGO:start -->\n      <h1 class="logo">\n        %s\n      </h1>\n      <!-- LOGO:end -->' % logo,
    )

    year = datetime.date.today().year
    credit = ("by %s &middot; %s" % (_esc(author), year)) if author else _esc(title)
    html = sub1(
        r"<!-- CREDIT:start.*?-->.*?<!-- CREDIT:end -->",
        '<!-- CREDIT:start -->\n      <p class="title-credit">%s</p>\n      <!-- CREDIT:end -->' % credit,
    )

    with open(index_html, "w", encoding="utf-8") as f:
        f.write(html)


# --------------------------------------------------------------------------- #
#  Python dependencies for playing / building a project                        #
# --------------------------------------------------------------------------- #

# playtest.py opens its window with pywebview; the packager freezes with
# PyInstaller. Everything else the engine needs is pure stdlib.
DEPS = ["pywebview", "pyinstaller"]


def _pip_python():
    """An interpreter we can run ``-m pip`` with. As a script that's just us;
    frozen into setup.exe, look for a real Python on PATH."""
    if not getattr(sys, "frozen", False):
        return sys.executable
    return shutil.which("python") or shutil.which("py")


def install_deps():
    """Best-effort ``pip install`` of DEPS. Never blocks the scaffold - on any
    problem it just prints the manual command. Returns True if deps are ready."""
    py = _pip_python()
    if not py:
        warn("no Python on PATH - skipping dependency install")
        note("run it yourself:  pip install " + " ".join(DEPS))
        return False
    with Spinner("Installing " + ", ".join(DEPS) + "  (pip)"):
        proc = subprocess.run(
            [py, "-m", "pip", "install", *DEPS],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace",
        )
    if proc.returncode == 0:
        ok("Dependencies ready  " + dim("(" + ", ".join(DEPS) + ")"))
        return True
    warn("pip couldn't install the dependencies")
    for ln in (proc.stdout or "").strip().splitlines()[-12:]:
        bar(dim(ln))
    note("run it yourself:  pip install " + " ".join(DEPS))
    return False


def _looks_like_vnengine_project(folder):
    """True only if `folder` contains a project.json written by this
    scaffolder (engine == "VNengine"). Guards the overwrite prompt against
    accidentally pointing setup.py at an unrelated, non-empty folder."""
    pj = os.path.join(folder, "project.json")
    try:
        with open(pj, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return False
    return isinstance(data, dict) and data.get("engine") == "VNengine"


def main():
    template = _template_dir()
    if template is None:
        checked = "\n     ".join(_template_candidates())
        die("'template' folder not found - put it next to setup.exe.\n"
            "     checked:\n     %s" % checked)

    header("VNengine", "new project scaffolder")

    name = ""
    while not VALID_NAME.match(name):
        name = ask("Project name", "").strip()
        if not VALID_NAME.match(name):
            warn("letters, digits, space, _ or - . 1-64 chars . starts alphanumeric")

    title = ask("Display title", name)
    author = ask("Author", "")
    dest_root = ask("Destination folder", os.getcwd())

    dest = os.path.abspath(os.path.join(os.path.expanduser(dest_root), name))
    if os.path.isdir(dest) and os.listdir(dest):
        file_count = sum(len(files) for _, _, files in os.walk(dest))
        if not _looks_like_vnengine_project(dest):
            die("%s exists and isn't a VNengine project (no project.json with "
                "\"engine\": \"VNengine\") - refusing to touch it. Pick a "
                "different name or destination folder." % dest)
        if not ask_yes("%s exists and is not empty (%d file%s) - overwrite its contents?" %
                       (dest, file_count, "" if file_count == 1 else "s")):
            bar(red("cancelled"))
            sys.exit(1)
        backup = dest + ".bak-" + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
        os.rename(dest, backup)
        note("previous contents kept at %s" % backup)

    with Spinner("Copying engine template into %s" % name):
        shutil.copytree(template, dest, dirs_exist_ok=True)

        index_html = os.path.join(dest, "index.html")
        if os.path.isfile(index_html):
            patch_index(index_html, title, author)

        with open(os.path.join(dest, "project.json"), "w", encoding="utf-8") as f:
            json.dump({
                "name": name,
                "title": title,
                "author": author,
                "engine": "VNengine",
                "created": datetime.date.today().isoformat(),
            }, f, indent=2)
            f.write("\n")

    bar()
    deps_ok = (install_deps()
               if ask_yes("Install the Python dependencies now "
                          "(pywebview, pyinstaller)?", default=True)
               else False)

    steps = ["cd " + dest]
    if not deps_ok:
        steps.append(green("pip install " + " ".join(DEPS)) +
                     dim("       deps for play / build"))
    steps += [
        green("python playtest.py") + dim("                       play it"),
        green("python tools/projectpackager-windows.py") + dim("   build it"),
    ]
    outro("Created  " + dest, steps)

    post_create_menu(dest)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
        sys.exit(130)
