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
    mode = "archive (%s)" % os.path.basename(ARCHIVE_PATH) if ARCHIVE is not None else "dev"

    # Already running (launched twice): just open a tab.
    if _port_busy(port):
        _open_browser(url, delay=0.2)
        print("VNengine - server already running, opened %s" % url)
        return

    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("VNengine - playtest server [%s]" % mode, flush=True)
    print("  %s" % url, flush=True)
    print("  Ctrl+C to stop", flush=True)
    _open_browser(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("stopped")
        httpd.server_close()


if __name__ == "__main__":
    main()
