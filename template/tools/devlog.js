/* ===========================================================
   VNengine - devlog: the browser -> playtest.py console bridge.

   A dev-only shim. playtest.py injects a <script> tag for this
   file into index.html *only when it has a console to print to*
   (running from source, or a --console "development" build). It
   is never referenced by index.html and never reaches a
   packaged "shipping" build.

   What it does: forwards everything you would otherwise only see
   in the browser's F12 console - the engine's boot-time script
   check, uncaught errors, failed image/audio loads - back to the
   terminal running playtest.py, so you never have to open F12.

   No DOM, no styling, no dependencies. It chains the original
   console methods, so F12 still works normally too.
   =========================================================== */
(function () {
  'use strict';

  var ENDPOINT = '/__vn/log';
  var FLUSH_MS = 250;
  var MAX_MSG = 4000;          // clip pathological single messages
  var MAX_QUEUE = 400;         // don't grow without bound if offline

  var queue = [];
  var timer = null;
  var groupDepth = 0;
  var sawProblem = false;      // anything worse than a plain log/info
  var okSent = false;

  /* ---------- formatting ---------- */

  function part(a) {
    if (a instanceof Error) return a.stack || (a.name + ': ' + a.message);
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch (e) { return String(a); }
  }
  function joinArgs(args) {
    var out = [];
    for (var i = 0; i < args.length; i++) out.push(part(args[i]));
    var s = out.join(' ');
    return s.length > MAX_MSG ? s.slice(0, MAX_MSG) + ' ...' : s;
  }

  /* ---------- queue + transport ---------- */

  function push(level, msg) {
    if (level === 'error' || level === 'warn') sawProblem = true;
    if (queue.length >= MAX_QUEUE) queue.shift();
    queue.push({ level: level, msg: msg, group: groupDepth, at: Date.now() });
    if (!timer) timer = setTimeout(flush, FLUSH_MS);
  }

  function flush(sync) {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!queue.length) return;
    var body = JSON.stringify({ entries: queue });
    queue = [];
    if (sync && navigator.sendBeacon) {
      try { navigator.sendBeacon(ENDPOINT, body); return; } catch (e) {}
    }
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  /* ---------- console wrappers (chain, don't replace) ---------- */

  var native = {};
  ['log', 'info', 'warn', 'error', 'group', 'groupCollapsed', 'groupEnd']
    .forEach(function (name) {
      native[name] = (console[name] || console.log).bind(console);
    });

  function wrap(name, level) {
    console[name] = function () {
      native[name].apply(null, arguments);
      push(level, joinArgs(arguments));
    };
  }
  wrap('log', 'log');
  wrap('info', 'log');
  wrap('warn', 'warn');
  wrap('error', 'error');

  console.group = function () {
    native.group.apply(null, arguments);
    push('group', joinArgs(arguments));
    groupDepth++;
  };
  console.groupCollapsed = console.group;
  console.groupEnd = function () {
    native.groupEnd();
    if (groupDepth > 0) groupDepth--;
  };

  /* ---------- runtime errors + failed asset loads ---------- */

  window.addEventListener('error', function (e) {
    if (e && e.target && e.target !== window &&
        (e.target.src || e.target.href)) {
      // resource that failed to load (img / audio / script / link)
      var url = e.target.src || e.target.href;
      var tag = (e.target.tagName || '?').toLowerCase();
      push('error', 'failed to load ' + tag + ': ' + url);
      return;
    }
    var where = e && e.filename
      ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : '';
    push('error', 'uncaught: ' + ((e && e.message) || 'error') + where);
  }, true);

  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    push('error', 'unhandled promise rejection: ' + part(r));
  });

  /* ---------- "all clear" once the dust settles ---------- */

  function settle() {
    if (okSent) return;
    okSent = true;
    if (!sawProblem) push('ok', 'no problems found');
    flush();
  }
  if (document.readyState === 'complete') setTimeout(settle, 500);
  else window.addEventListener('load', function () { setTimeout(settle, 500); });

  window.addEventListener('beforeunload', function () { flush(true); });
})();
