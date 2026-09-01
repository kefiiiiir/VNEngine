/* ===========================================================
   VNengine - save/position resolution.  Pure, DOM-free logic
   split out of engine.js so it can be:
     - loaded as a plain <script> in the browser (attaches
       window.VNSaveResolve), no build step, same as every
       other engine file
     - require()'d directly from plain Node for tests, with no
       DOM/window stubbing needed

   Covers: the script structural digest + hash used to detect
   script changes underneath a save, and the label-anchored
   (label, offset) position scheme that keeps saves pointing at
   the right line even after the script is edited.
   =========================================================== */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.VNSaveResolve = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function safeJson(v) { try { return JSON.stringify(v); } catch (e) { return ''; } }

  // A cheap structural digest of the script.  Stamped into every save so a
  // load can tell whether the script has changed underneath it.  We can't
  // JSON.stringify the ops directly - `if` conditions are functions - so we
  // fold in the meaningful fields by hand, cond functions included.
  //
  // Deliberately excludes `say`'s dialogue text: a writer fixing a typo or
  // rewording a line shouldn't invalidate every player's save. `who` (who's
  // speaking) still counts, since swapping speakers is a structural change.
  //
  // Position IS structural, so `show`'s `pos` and any explicit `x`/`y`/`scale`,
  // and the whole `move` op, are folded in. A cosmetic `transition`/`duration` on
  // `show`/`hide`/`move` is NOT (same call as `fx`, which hashes `effect` but
  // not `ms`). A legacy `show(who, expr, pos)` with no x/y digests to exactly
  // `show|who|expr|pos` as before, so upgrading the engine doesn't invalidate
  // existing saves.
  //
  // `log` (PlayTestLog) ops are skipped entirely - they are dev diagnostics,
  // so adding or removing one must not flag every player's save as stale.
  function digestOps(ops) {
    var out = [];
    for (var i = 0; i < ops.length; i++) {
      var o = ops[i], s = o.op || '?';
      if (o.op === 'log') continue;
      switch (o.op) {
        case 'say':    s += '|' + (o.who || ''); break;
        case 'label':  s += '|' + o.name; break;
        case 'jump':   s += '|' + o.to; break;
        case 'if':     s += '|' + o.to + '|' + String(o.cond); break;
        case 'set':    s += '|' + safeJson(o.vars); break;
        case 'scene':  s += '|' + o.bg; break;
        case 'show':
          s += '|' + o.who + '|' + (o.expr || '') + '|' + (o.pos || '');
          if (o.x != null || o.y != null || o.scale != null)
            s += '|' + (o.x || '') + '|' + (o.y || '') + '|' + (o.scale || '');
          break;
        case 'hide':   s += '|' + o.who; break;
        case 'move':
          s += '|' + o.who + '|' + (o.pos || '') + '|' + (o.x || '') + '|' +
               (o.y || '') + '|' + (o.scale || '');
          break;
        case 'fx':     s += '|' + o.effect + '|' + (o.color || ''); break;
        case 'choice':
          s += '|' + (o.options || []).map(function (x) {
            return (x.text || '') + '>' + (x.to || '');
          }).join(';');
          break;
        case 'chapterEnd': s += '|' + (o.title || '') + '|' + (o.next || ''); break;
      }
      out.push(s);
    }
    return out.join('\n');
  }

  function hashStr(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = (((h << 5) + h) ^ str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  // Builds the label -> index map plus a sorted [index, name] array for
  // binary-searching "which label are we currently under" (segmentNameAt),
  // instead of the O(labels) Object.keys().forEach scan that used to run on
  // every line of dialogue.
  function buildLabels(ops) {
    var labels = {}, dupes = {};
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (op.op === 'label') {
        if (labels[op.name] != null) dupes[op.name] = true;
        labels[op.name] = i;
      }
    }
    var sorted = Object.keys(labels)
      .map(function (nm) { return [labels[nm], nm]; })
      .sort(function (a, b) { return a[0] - b[0]; });
    return { labels: labels, dupes: dupes, sorted: sorted };
  }

  // Rightmost label whose index is <= ptr, via binary search over `sorted`
  // (as produced by buildLabels). O(log labels) instead of O(labels).
  function segmentNameAt(sorted, ptr) {
    var lo = 0, hi = sorted.length - 1, best = null;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (sorted[mid][0] <= ptr) { best = sorted[mid][1]; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    return best || '';
  }

  // Position as (nearest preceding label, ops since that label) instead of a
  // raw op index, so inserting a line in one scene doesn't shove every save
  // in every later scene onto the wrong line.
  function posFromPtr(labels, sorted, ptr) {
    var label = segmentNameAt(sorted, ptr);
    var base = (label && labels[label] != null) ? labels[label] : 0;
    return { label: label, offset: ptr - base };
  }

  function resolvePos(labels, opsLength, pos) {
    if (!pos) return 0;
    if (pos.label && labels[pos.label] != null)
      return Math.max(0, Math.min(labels[pos.label] + (pos.offset || 0), opsLength));
    if (typeof pos.ptr === 'number') return Math.max(0, Math.min(pos.ptr, opsLength));
    return 0;
  }

  return {
    safeJson: safeJson,
    digestOps: digestOps,
    hashStr: hashStr,
    buildLabels: buildLabels,
    segmentNameAt: segmentNameAt,
    posFromPtr: posFromPtr,
    resolvePos: resolvePos
  };
}));
