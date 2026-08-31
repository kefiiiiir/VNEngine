#!/usr/bin/env python3
"""
VNengine - project packager (Windows).

Ships inside every project at ``<project>/tools/``. Run it from the project
root - the "Build" button:

    projectpackager-windows            (or: python tools/projectpackager-windows.py)

Produces a distributable folder:

    <output>/<Project>/
        <Project>.exe      the game runtime (playtest.py frozen)
        <Project>.pak      index.html + project.json + css/ + js/ + src/, packed

index.html goes *into* the .pak now, not loose beside the .exe - a player
has no plain file to tamper with.

Two build profiles:

    development   console window, live browser diagnostics   (--console)
    shipping      windowed, no console                        (--windowed)

On the first run of a profile (or whenever ``playtest.py`` changed) it
freezes the runtime via ``projectpackager-tools/build-runtime.py`` and
caches it per profile; after that it is just copy + zip. Nothing is
prebuilt and shipped - the runtime always matches the current ``playtest.py``.

Everything this tool needs lives under ``tools/``:

    tools/
      projectpackager-windows(.py/.exe)
      devlog.js                  the dev-only console bridge (bundled into
                                 a development build; never into shipping)
      projectpackager-tools/
        build-runtime.py         does the freezing
        cache/                   built runtimes (per profile) + playtest hashes
"""

import os
import re
import sys
import json
import time
import shutil
import hashlib
import itertools
import threading
import subprocess
from collections import deque

ARCHIVE_DIRS = ("css", "js", "src")

FROZEN = getattr(sys, "frozen", False)


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
_FULL = "█" if UTF else "#"
_MTY = "░" if UTF else "."


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


def ask_yes(prompt):
    print("%s  %s  %s" % (cyan(G["act"]), bold(prompt), dim("[y/N]")))
    try:
        ans = input("%s  " % dim(G["bar"])).strip().lower()
    except (EOFError, KeyboardInterrupt):
        ans = ""
    bar()
    return ans in ("y", "yes")


def ask_choice(prompt, options, default):
    print("%s  %s" % (cyan(G["act"]), bold(prompt)))
    for i, o in enumerate(options, 1):
        tag = dim("  default") if o == default else ""
        bar("%s  %s%s" % (amber(str(i)), o, tag))
    raw = _read(dim("choose 1-%d  " % len(options)))
    bar()
    if not raw:
        return default
    try:
        return options[int(raw) - 1]
    except (ValueError, IndexError):
        return default


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


def progress(done, total, label=""):
    """Redraw an inline block bar on the `│` rail. Clears itself when full."""
    if not ANIM or total <= 0:
        return
    width = 22
    filled = round(width * done / total)
    b = _FULL * filled + _MTY * (width - filled)
    try:
        sys.stdout.write("\r%s  %s %s  %s\033[K" %
                         (dim(G["bar"]), cyan(b),
                          dim("%3d%%" % round(100 * done / total)), dim(label)))
        sys.stdout.flush()
        if done >= total:
            sys.stdout.write("\r\033[K")
            sys.stdout.flush()
    except Exception:
        pass


def outro(title, steps):
    bar()
    print("%s  %s" % (dim(G["bl"]), green(title)))
    for s in steps:
        print("   %s %s" % (dim(G["arrow"]), s))
    print()


class BuildBar:
    """Determinate progress bar for the runtime freeze - the same shape
    Claude Code's CLI shows while compacting. It walks PyInstaller's stage
    markers and creeps gently between them so it always looks alive.

    Used as a context manager; feed it PyInstaller's output line by line."""

    MARKERS = (
        ("Building Analysis because", 6),
        ("Running Analysis",          12),
        ("Caching module dependency", 30),
        ("Processing module hooks",   46),
        ("Building PYZ",              60),
        ("Building PKG",              74),
        ("Building EXE",              88),
        ("Build complete!",          100),
    )
    WIDTH = 26

    def __init__(self, label):
        self.label = label
        self.pct = 0.0
        self.cap = 10.0
        self._start = time.time()
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._t = None

    def __enter__(self):
        if ANIM:
            self._t = threading.Thread(target=self._loop, daemon=True)
            self._t.start()
        else:
            bar("%s  %s ..." % (dim(G["dot"]), self.label))
        return self

    def feed(self, line):
        for key, target in self.MARKERS:
            if key in line:
                with self._lock:
                    self.pct = max(self.pct, float(target))
                    self.cap = float(target)
                if not ANIM:
                    bar("%s  %s  %d%%" %
                        (dim(G["dot"]), self.label, int(self.pct)))
                break

    def _loop(self):
        frames = _SPIN
        i = 0
        while not self._stop.is_set():
            with self._lock:
                if self.pct < self.cap - 1:
                    self.pct += (self.cap - 1 - self.pct) * 0.045
            self._draw(frames[i % len(frames)])
            i += 1
            time.sleep(0.09)

    def _draw(self, spin):
        p = max(0.0, min(100.0, self.pct))
        fill = int(round(self.WIDTH * p / 100.0))
        b = cyan(_FULL * fill) + dim(_MTY * (self.WIDTH - fill))
        lb, rb = (dim("▕"), dim("▏")) if UTF else (dim("["), dim("]"))
        el = int(time.time() - self._start)
        try:
            sys.stdout.write("\r%s  %s  %s%s%s  %s  %s\033[K" % (
                dim(G["bar"]), cyan(spin), lb, b, rb,
                bold("%3d%%" % int(p)), dim("%2ds" % el)))
            sys.stdout.flush()
        except Exception:
            pass

    def __exit__(self, et, ev, tb):
        if self._t:
            self._stop.set()
            self._t.join()
        if ANIM:
            with self._lock:
                self.pct = 100.0
            self._draw(_SPIN[0])
            sys.stdout.write("\r\033[K")
            sys.stdout.flush()
        el = int(time.time() - self._start)
        if et is None:
            ok("%s  %s" % (self.label, dim("(%ds)" % el)))
        else:
            bar("%s  %s" % (red(G["cross"]), self.label))
        return False


# --- post-build "what now?" menu ----------------------------------------- #

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
    args = [folder]
    if first_file and os.path.isfile(first_file):
        args += ["-g", first_file]
    try:
        if os.name == "nt" and cmd.lower().endswith((".cmd", ".bat")):
            subprocess.Popen(["cmd", "/c", cmd, *args])
        else:
            subprocess.Popen([cmd, *args])
        return True
    except Exception:
        return False


def post_build_menu(out_dir):
    """Wait after a successful build: Enter -> open the build folder,
    Ctrl+Enter -> open it in VS Code, Esc -> just close. Skipped when there
    is no interactive terminal."""
    if not (sys.stdin.isatty() and sys.stdout.isatty()):
        return

    vscode = _vscode_cmd()
    vskey = cyan("Ctrl+Enter") if os.name == "nt" else cyan("V")
    hint = [cyan("Enter") + dim(" open the build folder")]
    if vscode:
        hint.append(vskey + dim(" open it in VS Code"))
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
                _open_explorer(out_dir)
                bar("%s  opening the build folder" % green(G["tick"]))
                return
            if vscode and key in ("LF", "v"):
                _open_vscode(vscode, out_dir)
                bar("%s  opening VS Code" % green(G["tick"]))
                return
            # anything else: keep waiting
    except KeyboardInterrupt:
        print()
        return


# --------------------------------------------------------------------------- #


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
BUILT_EXE = os.path.join(CACHE_DIR, "runtime-windows.exe")   # build-runtime's output


def _cache_slots(windowed):
    """Per-profile cache: (exe, playtest-hash) so switching profile doesn't
    force a rebuild of the other one."""
    tag = "ship" if windowed else "dev"
    return (os.path.join(CACHE_DIR, "runtime-windows-%s.exe" % tag),
            os.path.join(CACHE_DIR, "playtest-%s.sha256" % tag))


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


def ensure_runtime(project_dir, windowed, verbose=False):
    """Return a runtime .exe built from this project's playtest.py.

    Cached per profile under projectpackager-tools/cache/ and rebuilt only
    when playtest.py changed. ``windowed`` picks the shipping profile
    (--windowed); ``verbose`` streams PyInstaller's full log, otherwise the
    build shows a single progress bar."""
    playtest = os.path.join(project_dir, "playtest.py")
    sig = _sha256(playtest)
    cached_exe, cached_sig = _cache_slots(windowed)

    if os.path.isfile(cached_exe) and os.path.isfile(cached_sig):
        try:
            with open(cached_sig) as f:
                if f.read().strip() == sig:
                    ok("Runtime up to date  " + dim("(playtest.py unchanged)"))
                    return cached_exe
        except OSError:
            pass

    if not os.path.isfile(BUILD_RUNTIME):
        die("missing  " + BUILD_RUNTIME)
    py = _python()
    if not py:
        die("no Python found to build the runtime - put one at\n     %s"
            % os.path.join(PP_TOOLS, "python", "python.exe"))

    os.makedirs(CACHE_DIR, exist_ok=True)
    cmd = [py, BUILD_RUNTIME, playtest, CACHE_DIR]
    if windowed:
        cmd.append("--windowed")

    if verbose:
        note("Freezing runtime from playtest.py  " + dim("(verbose log)"))
        bar()
        rc = subprocess.call(cmd)
        if rc == 0 and os.path.isfile(BUILT_EXE):
            ok("Runtime built")
    else:
        note("Freezing runtime from playtest.py - first build can take a minute")
        tail = deque(maxlen=60)
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True,
                                encoding="utf-8", errors="replace", bufsize=1)
        with BuildBar("Building runtime") as bb:
            for line in proc.stdout:
                tail.append(line.rstrip("\n"))
                bb.feed(line)
            rc = proc.wait()
        if rc != 0:
            for ln in tail:
                bar(dim(ln))

    if rc != 0 or not os.path.isfile(BUILT_EXE):
        die("runtime build failed")
    shutil.copy2(BUILT_EXE, cached_exe)
    try:
        os.remove(BUILT_EXE)            # keep only the per-profile slots
    except OSError:
        pass
    with open(cached_sig, "w") as f:
        f.write(sig)
    return cached_exe


def build_archive(project_dir, archive_path):
    import zipfile
    files = []
    for d in ARCHIVE_DIRS:
        src = os.path.join(project_dir, d)
        if not os.path.isdir(src):
            continue
        for dirpath, _, names in os.walk(src):
            for fn in names:
                files.append(os.path.join(dirpath, fn))

    # index.html now lives inside the .pak; project.json rides along so the
    # runtime can title its window from the project's real metadata.
    for extra in ("index.html", "project.json"):
        p = os.path.join(project_dir, extra)
        if os.path.isfile(p):
            files.append(p)

    total = len(files)
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, full in enumerate(files, 1):
            rel = os.path.relpath(full, project_dir).replace("\\", "/")
            zf.write(full, rel)
            progress(i, total, rel[-34:])
    if not ANIM:
        bar("%s  packed %d file%s" %
            (dim(G["dot"]), total, "" if total == 1 else "s"))
    return total


def main():
    header("VNengine", "project packager . windows")

    project_dir = find_project()
    if project_dir is None:
        warn("couldn't find a project automatically")
        while project_dir is None or not is_project(project_dir):
            project_dir = os.path.abspath(os.path.expanduser(
                ask("Path to the project folder")))
            if not is_project(project_dir):
                warn("needs both playtest.py and index.html - try again")
    note("project  " + project_dir)
    bar()

    name = project_name(project_dir)
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", name).strip("_") or "game"

    ext = ask_choice("Archive format", [".pak", ".zip"], ".pak")

    PROFILE_DEV = "development  - console window, live diagnostics"
    PROFILE_SHIP = "shipping     - windowed, no console"
    profile = ask_choice("Build profile", [PROFILE_DEV, PROFILE_SHIP],
                         PROFILE_DEV)
    windowed = profile == PROFILE_SHIP

    LOG_NORMAL = "normal   - one progress bar"
    LOG_VERBOSE = "verbose  - full build log"
    logmode = ask_choice("Build output", [LOG_NORMAL, LOG_VERBOSE], LOG_NORMAL)
    verbose = logmode == LOG_VERBOSE

    out_root = os.path.abspath(os.path.expanduser(
        ask("Output directory", os.path.join(project_dir, "dist"))))
    out_dir = os.path.join(out_root, safe)
    if os.path.isdir(out_dir) and os.listdir(out_dir):
        if not ask_yes("%s exists and is not empty - overwrite?" % out_dir):
            bar(red("cancelled"))
            sys.exit(1)
        shutil.rmtree(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    runtime = ensure_runtime(project_dir, windowed, verbose=verbose)

    with Spinner("Copying runtime"):
        shutil.copy2(runtime, os.path.join(out_dir, safe + ".exe"))

    note("Packing %s%s" % (safe, ext))
    n = build_archive(project_dir, os.path.join(out_dir, safe + ext))
    ok("Packed %d file%s into %s%s" % (n, "" if n == 1 else "s", safe, ext))

    tag = "shipping" if windowed else "development"
    outro("Packaged  " + out_dir + dim("   (%s)" % tag),
          ["%s  %s" % (dim(G["dot"]), fn) for fn in sorted(os.listdir(out_dir))])

    post_build_menu(out_dir)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
        sys.exit(130)
