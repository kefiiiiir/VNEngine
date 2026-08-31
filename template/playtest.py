#!/usr/bin/env python3
"""
VNengine - playtest / runtime server.

Usage:
    python playtest.py            # first free port from 8000 up
    python playtest.py 5500       # prefer this port (falls forward if it's taken)

It opens the game in a **native window** (via pywebview) rather than a
browser tab. Closing that window stops the server - there is no separate
"Ctrl+C to stop" step. If pywebview is not installed it falls back to
opening your default browser and running until Ctrl+C.

Two modes, picked automatically:

  * Dev mode (default) - serves the files in this folder straight from disk.
    This is what you use while building your novel.

  * Archive mode - if a single ``*.pak`` or ``*.zip`` sits next to this
    script (or next to the built .exe), css/js/src *and* index.html are
    served out of that archive. This is what a packaged game (built by
    tools/projectpackager-windows.py) uses. The same file works either way.

Whenever it has a console to print to - running from source, or a
``--console`` "development" build - it injects a tiny dev shim
(``tools/devlog.js``) into index.html that forwards the browser's console
(the engine's boot-time script check, uncaught errors, failed asset loads)
back to this terminal. A ``--windowed`` "shipping" build has no console and
serves index.html untouched.

Set VN_NO_BROWSER=1 to serve headlessly (no window; Ctrl+C to stop).
"""

import io
import os
import re
import sys
import glob
import json
import signal
import socket
import zipfile
import mimetypes
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_PORT = 8000

# A real console means we can show diagnostics; a PyInstaller --windowed
# build has sys.stdout / sys.stderr set to None. Decide before we patch them.
DIAGNOSTICS = sys.stdout is not None and sys.stderr is not None


# --------------------------------------------------------------------------- #
#  tiny terminal UI - pure stdlib, safe to freeze, degrades to plain text     #
# --------------------------------------------------------------------------- #

if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")

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

G = {"tl": "┌", "bl": "└", "bar": "│", "tick": "✔", "cross": "✖", "dot": "•"} \
    if UTF else \
    {"tl": "+", "bl": "+", "bar": "|", "tick": "OK", "cross": "xx", "dot": "-"}


def _sgr(s, code):
    return s if not COLOR else "\033[%sm%s\033[0m" % (code, s)


def bold(s):  return _sgr(s, "1")
def dim(s):   return _sgr(s, "2")
def cyan(s):  return _sgr(s, "38;5;44")
def green(s): return _sgr(s, "38;5;42")
def red(s):   return _sgr(s, "38;5;203")
def amber(s): return _sgr(s, "38;5;215")


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

# Only paths under these prefixes (plus index.html itself) are ever read
# from the archive.
ARCHIVE_PREFIXES = ("css/", "js/", "src/")


def _find_archive():
    """Return the path to the lone .pak/.zip next to us, or None."""
    hits = sorted(glob.glob(os.path.join(BASE, "*.pak")) +
                  glob.glob(os.path.join(BASE, "*.zip")))
    return hits[0] if len(hits) == 1 else None


def _load_archive(path):
    """Read the whole archive into {normalized_path: bytes} once, up front.

    css/js/src (+ index.html) are small, and doing it eagerly keeps request
    handling trivially thread-safe under ThreadingHTTPServer (zipfile
    objects are not safe for concurrent reads)."""
    store = {}
    with zipfile.ZipFile(path) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            name = info.filename.replace("\\", "/").lstrip("/")
            if (name in ("index.html", "project.json") or
                    name.startswith(ARCHIVE_PREFIXES)):
                store[name] = zf.read(info)
    return store


ARCHIVE_PATH = _find_archive()
ARCHIVE = _load_archive(ARCHIVE_PATH) if ARCHIVE_PATH else None


# --------------------------------------------------------------------------- #
#  dev console bridge  -  tools/devlog.js  ->  /__vn/log  ->  this terminal   #
# --------------------------------------------------------------------------- #

def _devlog_src():
    """The devlog.js shim: bundled beside a frozen build, else tools/devlog.js."""
    cands = []
    mp = getattr(sys, "_MEIPASS", None)
    if mp:
        cands.append(os.path.join(mp, "devlog.js"))
    cands.append(os.path.join(BASE, "tools", "devlog.js"))
    for c in cands:
        if os.path.isfile(c):
            return c
    return None


DEVLOG_SRC = _devlog_src()
_DEVLOG_CACHE = None


def _devlog_bytes():
    global _DEVLOG_CACHE
    if _DEVLOG_CACHE is None:
        _DEVLOG_CACHE = b""
        if DIAGNOSTICS and DEVLOG_SRC:
            try:
                with open(DEVLOG_SRC, "rb") as f:
                    _DEVLOG_CACHE = f.read()
            except OSError:
                pass
    return _DEVLOG_CACHE


_INJECT_TAG = b'\n<script src="/__vn/devlog.js"></script>\n'


def _inject(html):
    """Drop the devlog <script> in just before </head> (or the first <script>)."""
    if b"/__vn/devlog.js" in html:
        return html
    low = html.lower()
    i = low.find(b"</head>")
    if i == -1:
        i = low.find(b"<script")
    if i == -1:
        return html + _INJECT_TAG
    return html[:i] + _INJECT_TAG + html[i:]


_print_lock = threading.Lock()
_log_state = {"started": False, "last": None}


def _print_browser_log(entries):
    """Render a batch of forwarded console entries under a 'browser' sub-head.

    Feedback taxonomy, kept quiet: red for errors, amber for warnings,
    green for the single 'all clear', dim for everything else. Consecutive
    duplicates are collapsed."""
    if not (DIAGNOSTICS and entries):
        return
    with _print_lock:
        for e in entries:
            if not isinstance(e, dict):
                continue
            lvl = e.get("level") or "log"
            msg = str(e.get("msg") or "").rstrip()
            if not msg:
                continue
            key = (lvl, msg)
            if key == _log_state["last"]:
                continue
            _log_state["last"] = key
            if not _log_state["started"]:
                _log_state["started"] = True
                bar()
                bar(dim("browser"))
            pad = "   " if e.get("group") else ""
            if lvl == "group":
                bar(bold(msg))
            elif lvl == "error":
                bar("%s%s  %s" % (pad, red(G["cross"]), msg))
            elif lvl == "warn":
                bar("%s%s  %s" % (pad, amber("!"), msg))
            elif lvl == "ok":
                bar("%s  %s" % (green(G["tick"]), msg))
            else:
                bar("%s%s" % (pad, dim(msg)))


# --------------------------------------------------------------------------- #
#  request handlers                                                           #
# --------------------------------------------------------------------------- #

class VNRoutes:
    """Shared /__vn/* routes + index.html shim injection.

    Mixed into both handlers. All of it is inert unless DIAGNOSTICS is on."""

    def _is_index(self):
        p = self.path.split("?", 1)[0].split("#", 1)[0]
        return p in ("/", "/index.html")

    def _read_index_disk(self):
        try:
            with open(os.path.join(BASE, "index.html"), "rb") as f:
                return f.read()
        except OSError:
            return None

    def _send_html(self, data):
        self._cache = "no-store"
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command == "GET":
            self.wfile.write(data)

    def _vn_get(self):
        """Handle a /__vn/* GET or HEAD. Return True if it was ours."""
        p = self.path.split("?", 1)[0]
        if p == "/__vn/devlog.js":
            body = _devlog_bytes()
            if not body:
                self.send_error(404)
                return True
            self._cache = "no-store"
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command == "GET":
                self.wfile.write(body)
            return True
        return False

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/__vn/log":
            self.send_error(404)
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        raw = self.rfile.read(min(n, 262144)) if n > 0 else b""
        entries = []
        try:
            entries = json.loads(raw.decode("utf-8") or "{}").get("entries") or []
        except (ValueError, AttributeError):
            pass
        _print_browser_log(entries)
        self._cache = None
        self.send_response(204)
        self.end_headers()

    # index.html, with the dev shim spliced in when we have a console
    def _serve_index(self, from_disk_fallback=True):
        data = None
        if ARCHIVE is not None:
            data = ARCHIVE.get("index.html")
        if data is None and from_disk_fallback:
            data = self._read_index_disk()
        if data is None:
            self.send_error(404, "index.html not found")
            return
        if _devlog_bytes():
            data = _inject(data)
        self._send_html(data)


class DevHandler(VNRoutes, SimpleHTTPRequestHandler):
    """Plain static server rooted at BASE.

    Dev mode = you are editing these files; the browser must never keep a
    stale copy. Sending ``no-store`` here is what makes the old ``?v=``
    query-string trick unnecessary."""

    def __init__(self, *args, **kwargs):
        self._cache = None
        super().__init__(*args, directory=BASE, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # keep the console quiet

    def do_GET(self):
        if self._vn_get():
            return
        if DIAGNOSTICS and self._is_index() and _devlog_bytes():
            return self._serve_index()
        return super().do_GET()

    def do_HEAD(self):
        if self._vn_get():
            return
        if DIAGNOSTICS and self._is_index() and _devlog_bytes():
            return self._serve_index()
        return super().do_HEAD()


class ArchiveHandler(VNRoutes, SimpleHTTPRequestHandler):
    """Serve index.html (+ css/js/src) from the in-memory archive.

    A packaged game's archived files never change for a given build, so they
    get a long immutable cache; only index.html is served ``no-store``.
    Older builds shipped index.html loose next to the .exe - if it isn't in
    the archive we still read it from disk."""

    def __init__(self, *args, **kwargs):
        self._cache = None
        super().__init__(*args, directory=BASE, **kwargs)

    def end_headers(self):
        if self._cache:
            self.send_header("Cache-Control", self._cache)
        super().end_headers()

    def log_message(self, fmt, *args):
        pass

    # --- routing -----------------------------------------------------------
    def _rel_path(self):
        p = self.path.split("?", 1)[0].split("#", 1)[0]
        p = p.lstrip("/")
        return "index.html" if p in ("", "index.html") else p

    def do_GET(self):
        if self._vn_get():
            return
        rel = self._rel_path()
        if rel == "index.html":
            return self._serve_index()
        data = ARCHIVE.get(rel)
        if data is None:
            self.send_error(404, "Not found in archive")
            return
        self._serve_bytes(rel, data)

    def do_HEAD(self):
        if self._vn_get():
            return
        rel = self._rel_path()
        if rel == "index.html":
            return self._serve_index()
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

        self._cache = "public, max-age=31536000, immutable"
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        if body:
            self.wfile.write(data[start:end + 1])


Handler = ArchiveHandler if ARCHIVE is not None else DevHandler


def _find_free_port(start, tries=100):
    """First bindable port at or above ``start`` on localhost, or None.

    A shipped game must not assume port 8000 is 'us' - on a busy dev machine
    it's just as likely to be someone else's server. Scan for a free one."""
    for p in range(start, start + tries):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind(("127.0.0.1", p))
            return p
        except OSError:
            continue
        finally:
            s.close()
    return None


def _open_browser(url, delay=1.0):
    if os.environ.get("VN_NO_BROWSER") == "1":
        return
    threading.Timer(delay, lambda: webbrowser.open(url)).start()


def _project_meta():
    """project.json as a dict - from the archive if packaged, else from disk
    beside us. The packager folds it into the .pak so a shipped build still
    has the project's real name / title / author."""
    raw = None
    if ARCHIVE is not None and "project.json" in ARCHIVE:
        raw = ARCHIVE["project.json"]
    else:
        try:
            with open(os.path.join(BASE, "project.json"), "rb") as f:
                raw = f.read()
        except OSError:
            pass
    try:
        return json.loads(raw.decode("utf-8")) if raw else {}
    except (ValueError, AttributeError):
        return {}


def _title_from_index():
    """Fall back to <title> in index.html (setup.py sets it to the project
    title). HTML-unescaped so '&amp;' etc. read correctly in the titlebar."""
    data = ARCHIVE.get("index.html") if ARCHIVE is not None else None
    if data is None:
        try:
            with open(os.path.join(BASE, "index.html"), "rb") as f:
                data = f.read()
        except OSError:
            return None
    m = re.search(rb"<title[^>]*>(.*?)</title>", data, re.I | re.S)
    if not m:
        return None
    t = m.group(1).decode("utf-8", "replace").strip()
    for a, b in (("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"),
                 ("&quot;", '"'), ("&#39;", "'")):
        t = t.replace(a, b)
    return t or None


def _window_title():
    meta = _project_meta()
    return (meta.get("title") or meta.get("name")
            or _title_from_index() or "VNengine")


def _serve_headless(httpd):
    """No window: serve until Ctrl+C. Used for VN_NO_BROWSER=1 and as the
    fallback when pywebview isn't installed."""
    note("Ctrl+C to stop")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    httpd.server_close()
    outro("stopped")


def _serve_windowed(httpd, url):
    """Native window via pywebview; closing it stops the server."""
    try:
        import webview
    except ImportError:
        note("pywebview not installed - opening your browser instead")
        note("pip install pywebview   for the app window")
        _open_browser(url)
        _serve_headless(httpd)
        return

    note("close the window to stop")
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()

    def _sigint(*_a):
        try:
            for w in list(getattr(webview, "windows", [])):
                w.destroy()
        except Exception:
            pass

    try:
        signal.signal(signal.SIGINT, _sigint)
    except Exception:
        pass

    webview.create_window(_window_title(), url, width=1280, height=800)
    webview.start()                      # blocks until every window closes

    httpd.shutdown()
    t.join(timeout=2)
    httpd.server_close()
    outro("stopped")


def main():
    requested = None
    if len(sys.argv) > 1:
        try:
            requested = int(sys.argv[1])
        except ValueError:
            pass

    mode = ("archive  " + os.path.basename(ARCHIVE_PATH)
            if ARCHIVE is not None else "dev mode")
    if DIAGNOSTICS:
        mode += "  .  diagnostics on"
    header("VNengine", "playtest server  .  " + mode)

    start = requested or DEFAULT_PORT
    httpd = None
    for _ in range(3):                       # scan, then retry if we lost a race
        port = _find_free_port(start)
        if port is None:
            bar("no free port near %d" % start)
            sys.exit(1)
        try:
            httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            start = port + 1
    if httpd is None:
        bar("could not bind a port")
        sys.exit(1)

    if requested and port != requested:
        note("port %d was busy - using %d" % (requested, port))

    url = "http://localhost:%d/index.html" % port
    ok("serving  " + cyan(url))

    if os.environ.get("VN_NO_BROWSER") == "1":
        _serve_headless(httpd)
    else:
        _serve_windowed(httpd, url)


# --------------------------------------------------------------------------- #
#  you can add any server code here if you need to
# --------------------------------------------------------------------------- #


if __name__ == "__main__":
    main()
