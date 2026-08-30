#!/usr/bin/env python3
"""
VNengine - playtest / runtime server.

Usage:
    python playtest.py            # port 8000; opens http://localhost:8000/index.html
    python playtest.py 5500       # custom port

Two modes, picked automatically:

  * Dev mode (default) - serves the files in this folder straight from disk.
    This is what you use while building your novel.

  * Archive mode - if a single ``*.pak`` or ``*.zip`` sits next to this
    script (or next to the built .exe), css/js/src are served out of that
    archive instead; ``index.html`` is still read from disk. This is what a
    packaged game (built by tools/projectpackager-windows.py) uses. The same
    file works either way, so packaging just means "freeze this to an .exe
    and drop a .pak beside it".

It only serves ``index.html`` plus whatever lives under css/ js/ src/ - no
game logic, no OS access, no extra HTTP routes.

Set VN_NO_BROWSER=1 to stop it from opening a browser tab.
Ctrl+C to stop.
"""

import io
import os
import sys
import glob
import socket
import zipfile
import mimetypes
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_PORT = 8000


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
            k.SetConsoleMode(handle, mode.value | 0x0004)
            touched = True
        return touched
    except Exception:
        return False


def _colors_ok():
    if os.environ.get("NO_COLOR") or os.environ.get("VNENGINE_PLAIN"):
        return False
    if not getattr(sys.stdout, "isatty", lambda: False)():
        return False
    return _enable_vt()


COLOR = _colors_ok()
UTF = "utf" in (getattr(sys.stdout, "encoding", "") or "").lower()

G = {"tl": "┌", "bl": "└", "bar": "│", "tick": "✔", "dot": "•"} if UTF else \
    {"tl": "+", "bl": "+", "bar": "|", "tick": "OK", "dot": "-"}


def _sgr(s, code):
    return s if not COLOR else "\033[%sm%s\033[0m" % (code, s)


def bold(s):  return _sgr(s, "1")
def dim(s):   return _sgr(s, "2")
def cyan(s):  return _sgr(s, "38;5;44")
def green(s): return _sgr(s, "38;5;42")


def grad(s, a=(0x33, 0xC8, 0xFF), b=(0x8B, 0x5C, 0xF6)):
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
    print(("%s  %s" % (dim(G["bar"]), s)) if s else dim(G["bar"]), flush=True)


def header(title, subtitle=""):
    print(flush=True)
    print("%s  %s" % (dim(G["tl"]), bold(grad(" " + title + " "))), flush=True)
    if subtitle:
        bar(dim(subtitle))
    bar()


def ok(s):   bar("%s  %s" % (green(G["tick"]), s))
def note(s): bar("%s  %s" % (dim(G["dot"]), dim(s)))


def outro(title):
    bar()
    print("%s  %s" % (dim(G["bl"]), green(title)), flush=True)
    print(flush=True)

# Where "next to me" is: the folder of the .exe when frozen (PyInstaller),
# otherwise the folder of this script.
if getattr(sys, "frozen", False):
    BASE = os.path.dirname(os.path.abspath(sys.executable))
else:
    BASE = os.path.dirname(os.path.abspath(__file__))

# Only paths under these prefixes are ever read from the archive.
ARCHIVE_PREFIXES = ("css/", "js/", "src/")


def _find_archive():
    """Return the path to the lone .pak/.zip next to us, or None."""
    hits = sorted(glob.glob(os.path.join(BASE, "*.pak")) +
                  glob.glob(os.path.join(BASE, "*.zip")))
    return hits[0] if len(hits) == 1 else None


def _load_archive(path):
    """Read the whole archive into {normalized_path: bytes} once, up front.

    css/js/src are small, and doing it eagerly keeps request handling
    trivially thread-safe under ThreadingHTTPServer (zipfile objects are
    not safe for concurrent reads)."""
    store = {}
    with zipfile.ZipFile(path) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            name = info.filename.replace("\\", "/").lstrip("/")
            if name.startswith(ARCHIVE_PREFIXES):
                store[name] = zf.read(info)
    return store


ARCHIVE_PATH = _find_archive()
ARCHIVE = _load_archive(ARCHIVE_PATH) if ARCHIVE_PATH else None


class DevHandler(SimpleHTTPRequestHandler):
    """Plain static server rooted at BASE (unchanged behaviour)."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE, **kwargs)

    def log_message(self, fmt, *args):
        pass  # keep the console quiet


class ArchiveHandler(SimpleHTTPRequestHandler):
    """Serve index.html from disk, css/js/src from the in-memory archive."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE, **kwargs)

    def log_message(self, fmt, *args):
        pass

    # --- routing -----------------------------------------------------------
    def _rel_path(self):
        p = self.path.split("?", 1)[0].split("#", 1)[0]
        p = p.lstrip("/")
        return "index.html" if p in ("", "index.html") else p

    def do_GET(self):
        rel = self._rel_path()
        if rel == "index.html":
            return super().do_GET()  # from disk, next to the exe
        data = ARCHIVE.get(rel)
        if data is None:
            self.send_error(404, "Not found in archive")
            return
        self._serve_bytes(rel, data)

    def do_HEAD(self):
        rel = self._rel_path()
        if rel == "index.html":
            return super().do_HEAD()
        data = ARCHIVE.get(rel)
        if data is None:
            self.send_error(404, "Not found in archive")
            return
        self._serve_bytes(rel, data, body=False)

    # --- response helpers ------------------------------------------------
    def _serve_bytes(self, rel, data, body=True):
        ctype = mimetypes.guess_type(rel)[0] or "application/octet-stream"
        total = len(data)
        rng = self.headers.get("Range")
        start, end = 0, total - 1

        if rng and rng.startswith("bytes="):
            try:
                s, _, e = rng[6:].partition("-")
                start = int(s) if s else 0
                end = int(e) if e else total - 1
                end = min(end, total - 1)
                if start > end or start >= total:
                    raise ValueError
            except ValueError:
                self.send_response(416)
                self.send_header("Content-Range", "bytes */%d" % total)
                self.end_headers()
                return
            self.send_response(206)
            self.send_header("Content-Range",
                             "bytes %d-%d/%d" % (start, end, total))
        else:
            self.send_response(200)

        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if body:
            self.wfile.write(data[start:end + 1])


Handler = ArchiveHandler if ARCHIVE is not None else DevHandler


def _port_busy(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.settimeout(0.25)
        return s.connect_ex(("127.0.0.1", port)) == 0
    finally:
        s.close()


def _open_browser(url, delay=1.0):
    if os.environ.get("VN_NO_BROWSER") == "1":
        return
    threading.Timer(delay, lambda: webbrowser.open(url)).start()


def main():
    port = DEFAULT_PORT
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass

    url = "http://localhost:%d/index.html" % port
    mode = ("archive  " + os.path.basename(ARCHIVE_PATH)
            if ARCHIVE is not None else "dev mode")

    header("VNengine", "playtest server  .  " + mode)

    # Already running (launched twice): just open a tab.
    if _port_busy(port):
        _open_browser(url, delay=0.2)
        ok("already running - reopened " + cyan(url))
        outro("done")
        return

    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    ok("serving  " + cyan(url))
    note("Ctrl+C to stop")
    _open_browser(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.server_close()
        outro("stopped")


# --------------------------------------------------------------------------- #
#  you can add any server code here if you need to
# --------------------------------------------------------------------------- #


if __name__ == "__main__":
    main()
