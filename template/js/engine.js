/* ===========================================================
   VNengine - core runtime.  Vanilla JS, no build step.
   Runs from a local server (playtest.py) or straight from
   file:// by double-clicking index.html.

   Reads:
     window.VNData   - backgrounds / characters      (js/data.js)
     window.VNScript - the script: { ops: [...] }     (js/story/chapter1.js, js/story/chapter2.js, ... via js/story/story-helpers.js)
     window.VNAudio  - music / sfx engine (optional)  (js/audio.js)
   =========================================================== */
(function () {
  'use strict';

  var D  = window.VNData;
  var SC = window.VNScript;
  var A  = window.VNAudio || null;

  function sfx(name, opts) { if (A) A.sfx(name, opts); }

  /* ---------- DOM ---------- */
  var el = {};
  ['titleMenu', 'btnContinue', 'btnCheckpoints', 'firstName', 'lastName', 'nameError', 'nameConfirm',
   'bgA', 'bgB', 'sprites', 'dialogueBox', 'nameBox', 'dialogueText', 'advanceArrow',
   'choices', 'btnSave', 'btnBacklog', 'btnRollback', 'btnSkip', 'btnAuto', 'btnSettings', 'btnQuit',
   'autoBadge', 'skipBadge',
   'endTitle', 'endContinue', 'settingsOverlay', 'setSpeed', 'setEffects', 'setSkipSeen',
   'setAutoDelay', 'setSkipUnseen', 'setMusicVol', 'setSfxVol', 'setMute',
   'checkpointsOverlay', 'cpList', 'cpClose', 'settingsClose',
   'backlogOverlay', 'backlogList', 'backlogClose',
   'compatOverlay', 'compatText', 'compatResume', 'compatRestart', 'compatTitle'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  // Critical nodes: if any are missing the engine can't run - say so clearly
  // instead of throwing an opaque TypeError halfway through setup. (The README
  // invites editing index.html, so a deleted id is a plausible mistake.)
  var CRITICAL = ['titleMenu', 'nameConfirm', 'firstName', 'lastName', 'nameError',
                  'bgA', 'bgB', 'sprites', 'nameBox', 'dialogueText', 'advanceArrow',
                  'choices', 'btnSave', 'btnSettings', 'btnQuit', 'endTitle', 'endContinue',
                  'settingsOverlay', 'setSpeed', 'setEffects', 'setSkipSeen',
                  'settingsClose', 'btnContinue'];
  var missing = CRITICAL.filter(function (id) { return !el[id]; });
  if (missing.length) {
    console.error('VNengine: index.html is missing required element id(s): ' +
                  missing.join(', ') + '. The engine will not start.');
    return;
  }

  var screens = {};
  [].forEach.call(document.querySelectorAll('.screen'), function (s) {
    screens[s.getAttribute('data-screen')] = s;
  });
  function showScreen(name) {
    Object.keys(screens).forEach(function (k) {
      screens[k].classList.toggle('is-active', k === name);
    });
    current.screen = name;
  }

  /* ---------- localStorage ---------- */
  var SAVE_KEY = 'vnengine_save', SET_KEY = 'vnengine_settings',
      CP_KEY = 'vnengine_checkpoints', SEEN_KEY = 'vnengine_seen';
  var CP_CAP = 30;
  var storageWarned = false;
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) {
      if (!storageWarned) {
        storageWarned = true;
        console.error('VNengine: localStorage write failed (' + (e && e.name || 'error') +
                      ') - saves are not persisting.');
        try { toast('Save failed - browser storage is full'); } catch (_) {}
      }
      return false;
    }
  }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function clone(o) { try { return JSON.parse(JSON.stringify(o || {})); } catch (e) { return {}; } }

  /* ---------- read-tracking ("seen") - global, its own key ----------
     "Have I read this line" is not per-save state, so it lives under one
     key instead of being cloned into every checkpoint (which used to blow
     the quota on a long novel).  Keyed by label+offset so inserting a line
     in one scene doesn't shift the keys for every scene after it. */
  var seenStore = lsGet(SEEN_KEY) || {};
  var seenDirty = false, seenTimer = null;
  function markSeen(key) {
    var was = !!seenStore[key];
    if (!was) {
      seenStore[key] = 1;
      seenDirty = true;
      if (!seenTimer) seenTimer = setTimeout(flushSeen, 1000);
    }
    return was;
  }
  function flushSeen() {
    seenTimer = null;
    if (seenDirty) { seenDirty = false; lsSet(SEEN_KEY, seenStore); }
  }
  window.addEventListener('beforeunload', flushSeen);

  var settings = { speed: 55, effects: true, skipSeen: false,
                   autoDelay: 1500, skipUnseen: false };
  (function loadSettings() {
    var s = lsGet(SET_KEY);
    if (s) {
      if (typeof s.speed === 'number') settings.speed = s.speed;
      if (typeof s.effects === 'boolean') settings.effects = s.effects;
      if (typeof s.skipSeen === 'boolean') settings.skipSeen = s.skipSeen;
      if (typeof s.autoDelay === 'number') settings.autoDelay = s.autoDelay;
      if (typeof s.skipUnseen === 'boolean') settings.skipUnseen = s.skipUnseen;
    }
  })();
  function saveSettings() { lsSet(SET_KEY, settings); }

  /* ---------- state ---------- */
  function freshState() {
    return {
      ptr: 0,
      vars: {},
      player: { first: '', last: '' },
      seen: seenStore,
      stage: { bg: 'black', sprites: {} }
    };
  }
  var state = freshState();
  var current = { screen: 'title' };
  var typing = false, typeTimer = null, fullHTML = '', waiter = null;
  var choicesOpen = false, overlayOpen = false;

  /* ---------- labels + script hash + validation ----------
     digestOps/hashStr/buildLabels/segmentNameAt/posFromPtr/resolvePos
     live in js/save-resolve.js (window.VNSaveResolve) - pure, DOM-free,
     shared with the Node tests in tests/. */
  var SR = window.VNSaveResolve;
  var labelInfo = SR.buildLabels(SC.ops);
  var LABELS = labelInfo.labels;
  var labelDupes = labelInfo.dupes;
  var LABELS_SORTED = labelInfo.sorted;

  var SCRIPT_HASH = SR.hashStr(SR.digestOps(SC.ops));

  function validateScript() {
    var errs = [], warns = [];
    var synthSfx = (A && A.SFX_NAMES) || [];
    var fileSfx = (D && D.SFX_FILES) || {};
    var known = function (name) {
      return synthSfx.indexOf(name) !== -1 || Object.prototype.hasOwnProperty.call(fileSfx, name);
    };
    Object.keys(labelDupes).forEach(function (nm) {
      errs.push('duplicate label "' + nm + '" - only the last one is reachable');
    });
    var unreachableFrom = -1, unreachableFlagged = false;
    SC.ops.forEach(function (o, i) {
      var near = SR.segmentNameAt(LABELS_SORTED, i);
      var at = ' (op #' + i + (near ? ', near "' + near + '"' : '') + ')';
      if ((o.op === 'jump' || o.op === 'if') && LABELS[o.to] == null)
        errs.push('unknown ' + o.op + ' target "' + o.to + '"' + at);
      if (o.op === 'choice') (o.options || []).forEach(function (opt) {
        if (opt.to != null && LABELS[opt.to] == null)
          errs.push('choice option -> unknown label "' + opt.to + '"' + at);
      });
      if ((o.op === 'say' || o.op === 'show' || o.op === 'move') && o.who && o.who !== 'mc' &&
          !(D.CHARACTERS && D.CHARACTERS[o.who]))
        warns.push('character "' + o.who + '" is not in VNData.CHARACTERS' + at);
      if ((o.op === 'show' || o.op === 'move') && o.pos &&
          !POSITIONS[o.pos] && o.x == null && o.y == null)
        warns.push('position "' + o.pos + '" is not in VNData.POSITIONS and no x/y given' +
                   ' - falls back to centre' + at);
      if (o.op === 'sfx' && o.name && !known(o.name))
        warns.push('sfx "' + o.name + '" is neither a synth sound nor in VNData.SFX_FILES' + at);
      if (o.op === 'log' && o.level != null &&
          ['normal', 'warning', 'critical'].indexOf(o.level) === -1)
        warns.push('PlayTestLog level "' + o.level + '" is not normal/warning/critical' +
                   ' - treated as normal' + at);
      if (o.op === 'scene' && o.bg && D.BACKGROUNDS && D.BACKGROUNDS[o.bg] === undefined)
        warns.push('background "' + o.bg + '" is not in VNData.BACKGROUNDS (treated as a raw path)' + at);

      if (unreachableFrom >= 0 && o.op !== 'label' && !unreachableFlagged) {
        unreachableFlagged = true;
        warns.push('unreachable code from op #' + i + ' - nothing jumps past the ' +
                   SC.ops[unreachableFrom].op + ' at #' + unreachableFrom +
                   ' (until the next label)');
      }
      if (o.op === 'label') { unreachableFrom = -1; unreachableFlagged = false; }
      else if (o.op === 'jump' || o.op === 'chapterEnd' || o.op === 'toTitle') {
        unreachableFrom = i; unreachableFlagged = false;
      }
    });

    if (!errs.length && !warns.length) return;
    var g = console.group ? console.group.bind(console) : console.log.bind(console);
    g('VNengine - script check (' + errs.length + ' error(s), ' + warns.length + ' warning(s))');
    errs.forEach(function (m) { console.error(m); });
    warns.forEach(function (m) { console.warn(m); });
    if (console.groupEnd) console.groupEnd();
  }

  /* ---------- image preload ---------- */
  (D.PRELOAD || []).forEach(function (src) { var im = new Image(); im.src = src; });

  /* ===========================================================
     STAGE: background + sprites
     =========================================================== */
  var bgLayers = [el.bgA, el.bgB], bgTop = 0;
  function setBg(name) {
    var path = (D.BACKGROUNDS[name] !== undefined) ? D.BACKGROUNDS[name] : name;
    var incoming = bgLayers[1 - bgTop];
    var outgoing = bgLayers[bgTop];
    if (path) {
      incoming.style.backgroundImage = 'url("' + path + '")';
      incoming.style.backgroundColor = '';
    } else {
      incoming.style.backgroundImage = 'none';
      incoming.style.backgroundColor = '#000';
    }
    incoming.classList.add('is-shown');
    outgoing.classList.remove('is-shown');
    bgTop = 1 - bgTop;
    state.stage.bg = name;
  }

  /* ---------- positions + character transitions ----------
     A "position" is { x, y } where x is the sprite's horizontal centre
     (share of stage width) and y lifts it off the floor (share of stage
     height, positive = up).  left/center/right are built in; a project adds
     more in VNData.POSITIONS, or a script passes { x, y } inline.  Named
     entries win over the defaults so a project can retune left/center/right. */
  var DEFAULT_POSITIONS = { left: { x: '18%' }, center: { x: '50%' }, right: { x: '82%' } };
  var POSITIONS = (function () {
    var out = {}, p = (D && D.POSITIONS) || {};
    Object.keys(DEFAULT_POSITIONS).forEach(function (k) { out[k] = DEFAULT_POSITIONS[k]; });
    Object.keys(p).forEach(function (k) { out[k] = p[k]; });
    return out;
  })();
  function cssLen(v) {
    if (v == null || v === '') return null;
    return (typeof v === 'number') ? (v + 'px') : String(v);
  }
  function resolvePlacement(spr) {              // spr = { pos, x, y, scale }
    var x = cssLen(spr.x), y = cssLen(spr.y);
    var named = spr.pos && POSITIONS[spr.pos];
    if (x == null) x = named ? cssLen(named.x) : '50%';
    if (y == null) y = (named && named.y != null) ? cssLen(named.y) : '0%';
    var sc = spr.scale;
    if (sc == null) sc = (named && named.scale != null) ? named.scale : 100;
    return { x: x, y: y, scale: String((Number(sc) || 100) / 100) };
  }
  var ENTER_KINDS = { fade: 1, rise: 1, 'slide-left': 1, 'slide-right': 1 };
  function enterKind(name) { return ENTER_KINDS[name] ? name : 'fade'; }
  var MOVE_EASE = { glide: 'ease-in-out', linear: 'linear', 'ease-in': 'ease-in', 'ease-out': 'ease-out' };
  function moveEase(name) { return MOVE_EASE[name] || 'ease-in-out'; }
  var SHOW_DUR_DEFAULT = 300;
  // How the NEXT renderSprites() should animate each id.  Transient - never
  // cloned into state / history / a save, so any restore path starts empty
  // and can't animate from a stale hint.
  var pendingAnim = {};

  function spriteSrc(ch, expr) {
    var s = ch.sprites || {};
    return s[expr] || s.idle || '';
  }
  function makePlaceholderSprite(ch, id) {
    var node = document.createElement('div');
    node.className = 'sprite sprite--ph';
    node.style.setProperty('--ph-color', ch.color || '#ffd9ec');
    node.innerHTML = '<span class="ph-name">' + (ch.name || id) + '</span>' +
                     '<span class="ph-note">no sprite</span>';
    return node;
  }
  function makeSpriteImg(ch, id) {
    var node = document.createElement('img');
    node.className = 'sprite';
    node.addEventListener('error', function () {
      var slot = this.parentNode;
      if (!slot || !slot.classList || !slot.classList.contains('sprite-slot')) return;
      slot.replaceChild(makePlaceholderSprite(ch, id), this);
    });
    return node;
  }
  // Diff the stage against the DOM by data-id instead of rebuilding it.
  // Rebuilding restarted spriteBob on every expression change (visible jump)
  // and killed the enter transition.  We only create/remove/update the
  // .sprite-slot that actually changed and swap `src` in place.
  //   renderSprites({ snap: true })  jumps straight to the target stage with
  //   no animation (used by every restore / rollback / checkpoint path).
  function renderSprites(opts) {
    var want = state.stage.sprites || {};
    var snap = !!(opts && opts.snap);
    if (snap) el.sprites.classList.add('vn-no-anim');

    var have = {};
    [].slice.call(el.sprites.children).forEach(function (n) {
      var id = n.getAttribute('data-id');
      if (id && !n.hasAttribute('data-leaving')) have[id] = n;
    });

    Object.keys(have).forEach(function (id) {
      if (want[id] && D.CHARACTERS[id]) return;
      var slot = have[id];
      var hint = pendingAnim[id] || {};
      var dur = (hint.dur != null ? hint.dur : SHOW_DUR_DEFAULT);
      slot.style.setProperty('--vn-dur', dur + 'ms');
      slot.setAttribute('data-enter', hint.exit || 'fade');
      slot.setAttribute('data-leaving', '1');
      slot.classList.remove('is-shown');
      var gone = function () { if (slot.parentNode) slot.parentNode.removeChild(slot); };
      slot.addEventListener('transitionend', gone, { once: true });
      setTimeout(gone, dur + 150);
    });

    Object.keys(want).forEach(function (id) {
      var ch = D.CHARACTERS[id];
      if (!ch) return;
      var s = want[id];
      var src = spriteSrc(ch, s.expr);
      var xy = resolvePlacement(s);
      var hint = pendingAnim[id] || {};
      var slot = have[id];

      if (!slot) {
        slot = document.createElement('div');
        slot.className = 'sprite-slot';
        slot.setAttribute('data-id', id);
        var node = src ? makeSpriteImg(ch, id) : makePlaceholderSprite(ch, id);
        if (src) node.setAttribute('src', src);
        slot.appendChild(node);
        slot.style.setProperty('--vn-x', xy.x);
        slot.style.setProperty('--vn-y', xy.y);
        slot.style.setProperty('--vn-scale', xy.scale);
        slot.style.setProperty('--vn-dur', (hint.dur != null ? hint.dur : SHOW_DUR_DEFAULT) + 'ms');
        slot.setAttribute('data-enter', hint.enter || 'fade');
        slot.setAttribute('data-pos', s.pos || '');
        el.sprites.appendChild(slot);
        void slot.offsetWidth;             // reflow so the enter transition plays
        slot.classList.add('is-shown');
        return;
      }

      // type flipped between real art and placeholder card -> swap the inner
      // node, keep the slot (and its position / shown state).
      var inner = slot.firstChild;
      var isImg = inner && inner.tagName === 'IMG';
      if ((src && !isImg) || (!src && isImg)) {
        var repl = src ? makeSpriteImg(ch, id) : makePlaceholderSprite(ch, id);
        if (src) repl.setAttribute('src', src);
        slot.replaceChild(repl, inner);
        inner = repl; isImg = !!src;
      } else if (isImg && inner.getAttribute('src') !== src) {
        inner.setAttribute('src', src);
      }

      if (slot.style.getPropertyValue('--vn-x') !== xy.x ||
          slot.style.getPropertyValue('--vn-y') !== xy.y ||
          slot.style.getPropertyValue('--vn-scale') !== xy.scale) {
        slot.style.setProperty('--vn-move-dur', (hint.moveDur || 0) + 'ms');
        slot.style.setProperty('--vn-move-ease', hint.moveEase || 'ease');
        void slot.offsetWidth;             // commit the new duration before the value change
        slot.style.setProperty('--vn-x', xy.x);
        slot.style.setProperty('--vn-y', xy.y);
        slot.style.setProperty('--vn-scale', xy.scale);
      }
      slot.setAttribute('data-pos', s.pos || '');
      slot.classList.add('is-shown');      // no re-fire of the enter transition
    });

    if (snap) {
      void el.sprites.offsetWidth;
      el.sprites.classList.remove('vn-no-anim');
    }
    pendingAnim = {};                       // hints are consumed once
  }
  function stageShow(id, expr, pos, x, y, scale, transition, duration) {
    state.stage.sprites[id] = {
      expr: expr || 'idle',
      pos: pos || null,
      x: (x == null ? undefined : x),
      y: (y == null ? undefined : y),
      scale: (scale == null ? undefined : scale)
    };
    pendingAnim[id] = {
      enter: enterKind(transition),
      dur: (duration != null ? duration : SHOW_DUR_DEFAULT)
    };
    renderSprites();
  }
  function stageHide(id, transition, duration) {
    pendingAnim[id] = {
      exit: enterKind(transition),
      dur: (duration != null ? duration : SHOW_DUR_DEFAULT)
    };
    delete state.stage.sprites[id];
    renderSprites();
  }
  function stageMove(c) {
    var id = c.who, spr = state.stage.sprites[id];
    if (!spr) {
      console.warn('VNengine: move("' + id + '") but they are not on stage - ' +
                   'show() them first (op #' + (state.ptr - 1) + ') - ignored.');
      toast('move: ' + id + ' is not shown');
      return;
    }
    if (c.pos != null) {
      spr.pos = c.pos;
      if (c.x == null) spr.x = undefined;       // a named destination clears
      if (c.y == null) spr.y = undefined;       // stale explicit coords / scale
      if (c.scale == null) spr.scale = undefined;
    }
    if (c.x != null) spr.x = c.x;
    if (c.y != null) spr.y = c.y;
    if (c.scale != null) spr.scale = c.scale;
    var dur = c.duration | 0;
    pendingAnim[id] = (dur > 0)
      ? { moveDur: dur, moveEase: moveEase(c.transition) }
      : { moveDur: 0 };
    renderSprites();
  }
  function highlight(id) {
    [].slice.call(el.sprites.children).forEach(function (n) {
      var mine = n.getAttribute('data-id') === id;
      n.classList.toggle('is-speaking', !!id && mine);
      n.classList.toggle('is-dim', !!id && !mine);
    });
  }
  function restoreStage() {
    pendingAnim = {};
    setBg(state.stage.bg || 'black');
    renderSprites({ snap: true });
  }

  /* ---------- name box tint ---------- */
  function readableInk(hex) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#fff';
    var h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.62 ? '#3a1e30' : '#fff';
  }
  function applyNameboxColor(ch, who) {
    var bg = '', ink = '';
    if (ch && ch.color) { bg = ch.color; ink = readableInk(ch.color); }
    else if (who === 'mc') { bg = '#7a3d63'; ink = '#fff'; }
    el.nameBox.style.background = bg;
    el.nameBox.style.color = ink;
  }

  /* ===========================================================
     TEXT
     =========================================================== */
  // Substitution order matters for safety: resolve tokens into the raw
  // string first, THEN html-escape the whole thing (so a player name or a
  // var value can never inject markup), THEN turn the [b]/[i]/[c] shortcuts
  // into real tags on the now-safe string. HTML-escaping alone stops real
  // injection, but [b]/[i]/[c=...] aren't HTML - they're plain-text markers
  // applyMarkup() expands *after* escaping, so a player-chosen value like a
  // name still reaches it unescaped-for-markup-purposes. So values that come
  // from the player (name) or from script `set` state (vars) are stripped
  // of any [x]/[/x]-shaped markup *before* substitution, so a player can't
  // name themselves "[b]Bob" and get it bolded. Writer-authored markup
  // elsewhere in the line (outside a substituted token) is untouched.
  function stripMarkup(v) { return String(v).replace(/\[\/?[a-z][\w#().,%=\s-]*\]/gi, ''); }
  function fmt(t) {
    var first = stripMarkup(state.player.first || 'Player');
    var last = stripMarkup(state.player.last || '');
    t = String(t)
      .replace(/\{first\}/g, first)
      .replace(/\{last\}/g, last)
      .replace(/\{name\}/g, (first + ' ' + last).trim())
      .replace(/\{(\w+)\}/g, function (m, k) {
        var v = state.vars[k];
        return (v === undefined || v === null) ? m : stripMarkup(v);
      });
    var div = document.createElement('div');
    div.textContent = t;
    return applyMarkup(div.innerHTML);
  }
  function applyMarkup(s) {
    return s
      .replace(/\[b\]([\s\S]*?)\[\/b\]/g, '<b>$1</b>')
      .replace(/\[i\]([\s\S]*?)\[\/i\]/g, '<i>$1</i>')
      .replace(/\[c=([#\w][\w#().,%\s-]{0,30})\]([\s\S]*?)\[\/c\]/g, function (m, col, inner) {
        return /^#[0-9a-f]{3,8}$|^[a-z]+$/i.test(col.trim())
          ? '<span style="color:' + col.trim() + '">' + inner + '</span>' : inner;
      });
  }
  function stripTags(s) { var d = document.createElement('div'); d.innerHTML = s; return d.textContent || ''; }

  function speedToDelay() {
    return Math.max(2, Math.round(55 - (settings.speed / 100) * 51));
  }
  function tokenize(html) {
    var tokens = [], re = /(<[^>]+>)|([\s\S])/g, m;
    while ((m = re.exec(html))) {
      tokens.push(m[1] ? { t: 'tag', v: m[1] } : { t: 'ch', v: m[2] });
    }
    return tokens;
  }
  function typeText(html, instant) {
    clearInterval(typeTimer);
    fullHTML = html;
    el.advanceArrow.classList.remove('is-shown');
    if (instant) {
      el.dialogueText.innerHTML = html;
      typing = false;
      if (waiter === 'say') el.advanceArrow.classList.add('is-shown');
      return;
    }
    typing = true;
    el.dialogueText.innerHTML = '';
    var tokens = tokenize(html), idx = 0, out = '', vis = 0;
    var delay = speedToDelay();
    typeTimer = setInterval(function () {
      if (idx >= tokens.length) { finishTyping(); return; }
      do { out += tokens[idx++].v; }
      while (idx < tokens.length && tokens[idx - 1].t === 'tag');
      el.dialogueText.innerHTML = out;
      var last = tokens[idx - 1];
      if (last && last.t === 'ch' && last.v.trim() && (++vis % 3 === 0)) sfx('type');
    }, delay);
  }
  function finishTyping() {
    clearInterval(typeTimer);
    el.dialogueText.innerHTML = fullHTML;
    typing = false;
    if (waiter === 'say') el.advanceArrow.classList.add('is-shown');
  }

  /* ===========================================================
     SCRIPT EXECUTION
     =========================================================== */
  function applySet(vars) {
    Object.keys(vars || {}).forEach(function (k) {
      var v = vars[k];
      if (v && typeof v === 'object' && '__set' in v) state.vars[k] = v.__set;   // abs(): assign
      else if (typeof v === 'number') state.vars[k] = (state.vars[k] || 0) + v;  // number: add
      else state.vars[k] = v;                                                    // else: assign
    });
  }
  function asyncNext(ms) { setTimeout(step, ms); return 'async'; }

  function step() {
    while (true) {
      if (state.ptr >= SC.ops.length) { theEnd(); return; }
      var c = SC.ops[state.ptr++];
      var r = exec(c);
      if (r === 'wait' || r === 'async') return;
    }
  }

  function exec(c) {
    switch (c.op) {
      case 'label':     return 'go';
      case 'jump':      return goToLabel(c.to);
      case 'if':        return c.cond(state) ? goToLabel(c.to) : 'go';
      case 'set':       applySet(c.vars); return 'go';
      case 'scene':     setBg(c.bg); return asyncNext(280);
      case 'pause':     return asyncNext(c.ms || 300);
      case 'show':      stageShow(c.who, c.expr, c.pos, c.x, c.y, c.scale, c.transition, c.duration); return 'go';
      case 'hide':      stageHide(c.who, c.transition, c.duration); return 'go';
      case 'move':      stageMove(c); return 'go';
      case 'say':       doSay(c); return 'wait';
      case 'choice':    doChoice(c); return 'wait';
      case 'music':     if (A) A.music(c.name, c.opts); return 'go';
      case 'stopMusic': if (A) A.stopMusic(c.opts); return 'go';
      case 'sfx':       sfx(c.name, c.opts); return 'go';
      case 'sfxStop':   if (A && A.stopFile) A.stopFile(c.name, c.fade); return 'go';
      case 'duck':      if (A) A.duck(c.amount, c.ms); return 'go';
      case 'fx':        runFx(c); return 'go';
      case 'log':       runLog(c); return 'go';
      case 'save':      pushCheckpoint(c.label || null); return 'go';
      case 'chapterEnd': doChapterEnd(c); return 'async';
      case 'toTitle':   toTitle(); return 'wait';
    }
    return 'go';
  }
  // Guard label jumps the way pickChoice already does - a typo'd target used
  // to set ptr to undefined and crash on the next op with a useless message.
  function goToLabel(name) {
    if (LABELS[name] == null) {
      console.error('VNengine: jump to unknown label "' + name + '" (op #' + (state.ptr - 1) + ') - ignored.');
      toast('Broken jump: ' + name);
      return 'go';
    }
    state.ptr = LABELS[name];
    return 'go';
  }

  function doSay(c) {
    cancelAuto();
    var here = state.ptr - 1;
    var pos = SR.posFromPtr(LABELS, LABELS_SORTED, here);
    var seenKey = pos.label + '#' + pos.offset;
    var who = c.who;
    var ch = who && D.CHARACTERS[who];
    var nm = '';
    if (who === 'mc') nm = state.player.first || 'Player';
    else if (ch) nm = ch.name;
    el.nameBox.textContent = nm;
    applyNameboxColor(ch, who);

    if (ch && c.expr && state.stage.sprites[who]) {
      state.stage.sprites[who].expr = c.expr;
      renderSprites();
    }
    highlight(ch ? who : null);

    pushHistory(here);
    playVoice(c.voice);

    waiter = 'say';
    var display = fmt(c.text);
    backlogAdd(nm, display);
    var wasSeen = markSeen(seenKey);
    lastInstant = !!((settings.skipSeen && wasSeen) ||
                     (skipOn() && (wasSeen || settings.skipUnseen)));
    typeText(display, lastInstant);
    scheduleAuto();
  }

  function visibleOptions(items) {
    return (items || []).filter(function (o) {
      return typeof o.show === 'function' ? !!o.show(state) : true;
    });
  }
  function renderChoiceButtons(items, onPick) {
    el.nameBox.textContent = '';
    el.dialogueText.innerHTML = '';
    el.advanceArrow.classList.remove('is-shown');
    el.choices.hidden = false;
    el.choices.innerHTML = '';
    items.forEach(function (o, i) {
      var b = document.createElement('button');
      b.innerHTML = '<b style="opacity:.45;margin-right:.6em">' + (i + 1) + '</b>' + fmt(o.text);
      b.addEventListener('mouseenter', function () { sfx('hover'); });
      b.addEventListener('click', function () { sfx('click'); onPick(i); });
      el.choices.appendChild(b);
    });
    sfx('choice');
  }
  function doChoice(c) {
    cancelAuto();
    pushHistory(state.ptr - 1);
    var opts = visibleOptions(c.options);
    if (!opts.length) {
      console.warn('VNengine: choice at op #' + (state.ptr - 1) +
                   ' has no visible options - skipping it.');
      waiter = null;
      step();
      return;
    }
    choicesOpen = true;
    waiter = null;
    renderChoiceButtons(opts, function (i) { pickChoice(opts[i]); });
  }
  function pickChoice(o) {
    if (!choicesOpen) return;
    choicesOpen = false;
    el.choices.hidden = true;
    el.choices.innerHTML = '';
    if (o.set) applySet(o.set);
    if (o.to != null && LABELS[o.to] != null) state.ptr = LABELS[o.to];
    step();
  }

  /* ---------- rollback / backlog ---------- */
  var history = [], HIST_CAP = 50;
  var backlog = [], BACKLOG_CAP = 200;
  function pushHistory(ptrOfOp) {
    history.push({
      ptr: ptrOfOp,
      vars: clone(state.vars),
      player: clone(state.player),
      stage: clone(state.stage)
    });
    if (history.length > HIST_CAP) history.shift();
  }
  function rollback() {
    if (overlayOpen || choicesOpen || current.screen !== 'vn') return;
    if (history.length < 2) return;
    // history[last] is the line we're on, history[last-1] the one before it.
    // Drop both; step() re-runs the target op and re-pushes its entry, so the
    // buffer keeps its true depth and repeated rollbacks keep going back.
    var h = history[history.length - 2];
    history.length -= 2;
    state.vars = clone(h.vars);
    state.player = clone(h.player);
    state.stage = h.stage ? clone(h.stage) : { bg: 'black', sprites: {} };
    if (!state.stage.sprites) state.stage.sprites = {};
    state.ptr = h.ptr;
    cancelAuto();
    clearInterval(typeTimer); typing = false;
    pendingAnim = {};
    waiter = null; choicesOpen = false; el.choices.hidden = true;
    if (A && A.stopAllFiles) A.stopAllFiles(0.15);
    restoreStage();
    step();
  }
  function backlogAdd(name, html) {
    backlog.push({ name: name, html: html });
    if (backlog.length > BACKLOG_CAP) backlog.shift();
  }
  function renderBacklog() {
    if (!el.backlogList) return;
    el.backlogList.innerHTML = '';
    if (!backlog.length) {
      var em = document.createElement('li');
      em.className = 'cp-empty';
      em.textContent = 'Nothing yet.';
      el.backlogList.appendChild(em);
      return;
    }
    backlog.forEach(function (row) {
      var li = document.createElement('li');
      li.className = 'bl-row';
      if (row.name) {
        var nm = document.createElement('span');
        nm.className = 'bl-name';
        nm.textContent = row.name;
        li.appendChild(nm);
      }
      var tx = document.createElement('span');
      tx.className = 'bl-text';
      tx.innerHTML = row.html;            // already escaped + whitelisted by fmt()
      li.appendChild(tx);
      el.backlogList.appendChild(li);
    });
    el.backlogList.scrollTop = el.backlogList.scrollHeight;
  }
  function openBacklog() {
    if (!el.backlogOverlay) return;
    overlayOpen = true;
    cancelAuto();
    renderBacklog();
    el.backlogOverlay.hidden = false;
  }
  function closeBacklog() {
    overlayOpen = false;
    if (el.backlogOverlay) el.backlogOverlay.hidden = true;
  }

  /* ---------- skip / auto-advance (top-bar buttons only) ---------- */
  var autoActive = false, skipActive = false;
  var autoTimer = null, skipTimer = null, lastInstant = false;
  function skipOn() { return skipActive; }
  function updateBadges() {
    if (el.autoBadge) el.autoBadge.hidden = !autoActive;
    if (el.skipBadge) el.skipBadge.hidden = !skipActive;
    if (el.btnAuto) el.btnAuto.classList.toggle('is-on', autoActive);
    if (el.btnSkip) el.btnSkip.classList.toggle('is-on', skipActive);
  }
  function cancelAuto() {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    if (skipTimer) { clearTimeout(skipTimer); skipTimer = null; }
  }
  function scheduleAuto() {
    cancelAuto();
    if (current.screen !== 'vn' || waiter !== 'say') return;
    if (skipOn() && lastInstant) {
      skipTimer = setTimeout(function () {
        if (skipOn() && waiter === 'say' && !choicesOpen && !overlayOpen) { waiter = null; step(); }
      }, 45);
      return;
    }
    if (autoActive) {
      var kick = function () {
        if (typing) { autoTimer = setTimeout(kick, 120); return; }
        var wait = (settings.autoDelay || 1500) + Math.min(2200, (fullHTML || '').length * 26);
        autoTimer = setTimeout(function () {
          if (autoActive && waiter === 'say' && !choicesOpen && !overlayOpen) { waiter = null; step(); }
        }, wait);
      };
      kick();
    }
  }
  function toggleAuto() {
    autoActive = !autoActive;
    if (autoActive) skipActive = false;
    updateBadges();
    scheduleAuto();
  }
  function toggleSkip() {
    skipActive = !skipActive;
    if (skipActive) autoActive = false;
    updateBadges();
    if (waiter === 'say') { lastInstant = true; scheduleAuto(); }
  }
  function stopModes() {
    autoActive = skipActive = false;
    cancelAuto();
    updateBadges();
  }

  /* ---------- voice ---------- */
  var curVoice = null;
  function playVoice(name) {
    if (!A || !A.playFile) return;
    if (curVoice && A.stopFile) A.stopFile(curVoice, 0.1);
    curVoice = null;
    if (name) { curVoice = name; A.playFile(name); }
  }
  function stopVoice() {
    if (A && A.stopFile && curVoice) A.stopFile(curVoice, 0.15);
    curVoice = null;
  }

  /* ---------- chapter end ---------- */
  function doChapterEnd(c) {
    if (A && A.stopAllFiles) A.stopAllFiles(0.3);
    if (A && A.crushMusic) A.crushMusic(false);
    curVoice = null;
    document.body.classList.remove('fx-shake');
    stopModes();
    var here = state.ptr - 1;
    var nextPtr = (c.next != null && LABELS[c.next] != null) ? LABELS[c.next] : here;
    state.ptr = nextPtr;
    pushCheckpoint(fmt(c.title || 'End of chapter'), { isChapterEnd: true });
    state.ptr = here;
    lsSet(SAVE_KEY, makeSaveRecord(here));
    refreshContinue();
    el.endTitle.textContent = fmt(c.title || 'End of chapter');
    showScreen('end');
    sfx('stinger');
    el.endContinue.onclick = function () {
      if (c.next != null && LABELS[c.next] != null) {
        state.ptr = LABELS[c.next];
        history = []; backlog = [];
        showScreen('vn');
        restoreStage();
        step();
      } else {
        toTitle();
      }
    };
  }

  function theEnd() {
    stopModes();
    if (A && A.stopAllFiles) A.stopAllFiles(0.3);
    curVoice = null;
    el.endTitle.textContent = 'The End';
    showScreen('end');
    el.endContinue.onclick = function () { toTitle(); };
  }

  /* ===========================================================
     EFFECTS - deliberately tiny.  flash / shake are screen
     effects (gated by the "Screen effects" setting); crushmusic
     is the one kept audio-processing example (see js/audio.js).
     =========================================================== */
  function pulseClass(node, cls, ms) {
    if (!node) return;
    node.classList.remove(cls);
    void node.offsetWidth;            // restart the animation
    node.classList.add(cls);
    setTimeout(function () { node.classList.remove(cls); }, ms);
  }
  function runFx(c) {
    var e = c.effect;
    if (e === 'crushmusic') { if (A && A.crushMusic) A.crushMusic(c.on !== false); return; }
    if (!settings.effects) return;
    if (e === 'shake') {
      pulseClass(document.body, 'fx-shake', c.ms || 420);
    } else if (e === 'flash') {
      var d = document.createElement('div');
      d.className = 'fx-flash fx-flash--' + (c.color || 'white');
      if (c.ms) d.style.animationDuration = c.ms + 'ms';
      document.getElementById('game').appendChild(d);
      // Remove on the animation's own end so the fade always completes,
      // instead of yanking the node at a fixed 260ms mid-fade.
      var done = function () { if (d.parentNode) d.parentNode.removeChild(d); };
      d.addEventListener('animationend', done, { once: true });
      setTimeout(done, (c.ms || 900) + 400);   // safety net
    }
  }

  /* ---------- PlayTestLog: author -> playtest.py terminal ----------
     Resolves c.message (call it if it's a function - it gets `state`;
     JSON-stringify an object; String() anything else) and routes it
     through console.* so tools/devlog.js forwards it to the terminal.
     'normal' -> dim, 'warning' -> amber, 'critical' -> red.  In a
     shipped build there's no devlog and console.* just goes nowhere. */
  function runLog(c) {
    var m = c.message, text;
    try {
      if (typeof m === 'function') m = m(state);
      if (typeof m === 'string') text = m;
      else if (m == null) text = String(m);
      else if (typeof m === 'object') {
        try { text = JSON.stringify(m); } catch (e) { text = String(m); }
      } else text = String(m);
    } catch (err) {
      console.error('VNengine: PlayTestLog message threw (op #' + (state.ptr - 1) + ') - ' +
                    (err && err.stack || err));
      return;
    }
    var lvl = c.level;
    if (lvl === 'critical') console.error(text);
    else if (lvl === 'warning') console.warn(text);
    else console.log(text);
  }

  /* ===========================================================
     SAVE / CHECKPOINTS
     =========================================================== */
  function readCheckpoints() {
    var a = lsGet(CP_KEY);
    return (a && a.length) ? a : [];
  }
  // segmentNameAt/posFromPtr/resolvePos live in js/save-resolve.js
  // (window.VNSaveResolve, aliased to SR above).
  function makeSaveRecord(ptr) {
    return {
      v: 3, hash: SCRIPT_HASH, pos: SR.posFromPtr(LABELS, LABELS_SORTED, ptr),
      vars: clone(state.vars), player: clone(state.player), stage: clone(state.stage)
    };
  }
  function pushCheckpoint(label, opts) {
    opts = opts || {};
    var ptr = (opts.ptr != null) ? opts.ptr : state.ptr;
    var rec = makeSaveRecord(ptr);
    var cp = {
      id: 'cp' + Date.now().toString(36) + '_' + ((Math.random() * 1e6) | 0).toString(36),
      label: label || SR.segmentNameAt(LABELS_SORTED, ptr) || 'Autosave',
      isChapterEnd: !!opts.isChapterEnd,
      ts: Date.now(),
      v: 3, hash: rec.hash, pos: rec.pos,
      vars: rec.vars, player: rec.player, stage: rec.stage
    };
    var list = readCheckpoints();
    list.push(cp);
    while (list.length > CP_CAP) {
      var idx = -1;
      for (var i = 0; i < list.length; i++) { if (!list[i].isChapterEnd) { idx = i; break; } }
      if (idx < 0) break;
      list.splice(idx, 1);
    }
    var okList = lsSet(CP_KEY, list);
    var okSave = lsSet(SAVE_KEY, rec);
    refreshContinue();
    cp._ok = okList && okSave;
    return cp;
  }

  var pendingCompat = null;
  function applySnapshot(s) {
    state = freshState();
    state.vars = s.vars || {};
    state.player = s.player || { first: '', last: '' };
    state.stage = s.stage || { bg: 'black', sprites: {} };
    if (!state.stage.sprites) state.stage.sprites = {};

    var mismatch = false, canRestartChapter = true;
    if (s.v === 3) {
      if (s.hash !== SCRIPT_HASH) mismatch = true;
      if (!s.pos || (s.pos.label && LABELS[s.pos.label] == null)) {
        mismatch = true;
        canRestartChapter = !!(s.pos && s.pos.label && LABELS[s.pos.label] != null);
      }
      state.ptr = SR.resolvePos(LABELS, SC.ops.length, s.pos);
    } else {
      // legacy save (v1: raw ptr index. v2: pos-anchored like v3, but its
      // hash included dialogue text, so it can't be trusted as "same
      // version" anymore) - no reliable hash to compare, warn to be safe,
      // but still resolve position if we can (v2's `pos` shape works with
      // resolvePos same as v3; v1's raw `ptr` is the fallback inside it).
      mismatch = true;
      canRestartChapter = false;
      state.ptr = (s.pos && s.pos.label && LABELS[s.pos.label] != null)
        ? SR.resolvePos(LABELS, SC.ops.length, s.pos)
        : ((typeof s.ptr === 'number') ? Math.max(0, Math.min(s.ptr, SC.ops.length)) : 0);
    }
    pendingCompat = mismatch
      ? { label: (s.pos && s.pos.label) || '', canRestartChapter: canRestartChapter }
      : null;
    history = []; backlog = [];
    return true;
  }
  function loadSave() {
    var s = lsGet(SAVE_KEY);
    if (!s) return false;
    applySnapshot(s);
    return true;
  }
  function loadCheckpoint(cp) {
    if (!cp) return false;
    applySnapshot(cp);
    lsSet(SAVE_KEY, makeSaveRecord(state.ptr));
    refreshContinue();
    return true;
  }
  function refreshContinue() {
    el.btnContinue.disabled = !lsGet(SAVE_KEY);
    if (el.btnCheckpoints) el.btnCheckpoints.disabled = !readCheckpoints().length;
  }
  // Called after any save-load path.  If the script changed under the save,
  // ask the player what to do instead of silently resuming into garbage.
  function resumeAfterLoad() {
    showScreen('vn');
    restoreStage();
    if (pendingCompat) { openCompat(pendingCompat); pendingCompat = null; }
    else step();
  }
  function openCompat(info) {
    overlayOpen = true;
    if (el.compatText) {
      el.compatText.textContent = 'This save was made with a different version of the script. ' +
        'Resuming may land you in the wrong place.';
    }
    if (el.compatRestart) el.compatRestart.hidden = !info.canRestartChapter;
    el._compatInfo = info;
    if (el.compatOverlay) el.compatOverlay.hidden = false;
  }
  function closeCompat() {
    overlayOpen = false;
    if (el.compatOverlay) el.compatOverlay.hidden = true;
  }

  /* ---------- toast ---------- */
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'vn-toast';
    t.textContent = msg;
    (document.getElementById('game') || document.body).appendChild(t);
    setTimeout(function () { t.classList.add('is-in'); }, 20);
    setTimeout(function () { t.classList.remove('is-in'); }, 1700);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2200);
  }

  /* ---------- in-world confirm ----------
     Replaces window.confirm() - a browser dialog reading "localhost says..."
     shatters the mood. Same job, styled like the rest of the game, async via
     a callback: askConfirm(opts, function (yes) { ... }).
       opts.title / body            heading + line of explanation
       opts.confirmText / cancelText button labels
       opts.danger                  red confirm button, focus defaults to Cancel
     Escape or a click on the backdrop counts as Cancel - never a dead end. */
  function askConfirm(opts, onDone) {
    opts = opts || {};
    var wasOverlay = overlayOpen;
    overlayOpen = true;

    var ov = document.createElement('div');
    ov.className = 'overlay vn-ask';
    var card = document.createElement('div');
    card.className = 'overlay-card';

    if (opts.title) {
      var h = document.createElement('h2');
      h.textContent = opts.title;
      card.appendChild(h);
    }
    var body = document.createElement('p');
    body.className = 'cp-hint vn-ask-body';
    body.textContent = opts.body || 'Are you sure?';
    card.appendChild(body);

    var row = document.createElement('div');
    row.className = 'vn-ask-actions';
    var cancel = document.createElement('button');
    cancel.className = 'vn-ask-cancel';
    cancel.textContent = opts.cancelText || 'Cancel';
    var okBtn = document.createElement("button");
    okBtn.textContent = opts.confirmText || "OK";
    if (opts.danger) okBtn.className = "vn-ask-danger";
    row.appendChild(cancel);
    row.appendChild(okBtn);
    card.appendChild(row);
    ov.appendChild(card);
    (document.getElementById('game') || document.body).appendChild(ov);

    void ov.offsetWidth;              // commit the pre-transition state...
    ov.classList.add('is-in');        // ...then flip, so it animates even if
                                     // the tab was backgrounded (no rAF)
    (opts.danger ? cancel : okBtn).focus();

    var settled = false;
    function finish(val) {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      ov.classList.remove('is-in');
      setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 240);
      overlayOpen = wasOverlay;
      sfx(val ? 'confirm' : 'back');
      if (onDone) onDone(val);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); finish(false); }
      else if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); finish(true); }
    }
    document.addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', function () { finish(false); });
    okBtn.addEventListener("click", function () { finish(true); });
    ov.addEventListener('click', function (e) { if (e.target === ov) finish(false); });
  }
  function manualCheckpoint() {
    var cp = pushCheckpoint('Manual - ' + (SR.segmentNameAt(LABELS_SORTED, state.ptr) || 'save'));
    var prev = el.btnSave.textContent;
    el.btnSave.textContent = cp._ok ? '✓' : '✕';
    setTimeout(function () { el.btnSave.textContent = prev; }, 800);
    toast(cp._ok ? 'Checkpoint saved' : 'Save failed - storage full');
  }

  /* ---------- checkpoints overlay ---------- */
  function agoStr(ts) {
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + ' h ago';
    return Math.round(h / 24) + ' d ago';
  }
  function renderCpList() {
    if (!el.cpList) return;
    var list = readCheckpoints().slice().reverse();
    el.cpList.innerHTML = '';
    if (!list.length) {
      var em = document.createElement('li');
      em.className = 'cp-empty';
      em.textContent = 'No checkpoints yet.';
      el.cpList.appendChild(em);
      return;
    }
    list.forEach(function (cp) {
      var li = document.createElement('li');
      li.className = 'cp-row';
      var main = document.createElement('span');
      main.className = 'cp-label';
      main.textContent = cp.label || 'Checkpoint';
      var meta = document.createElement('span');
      meta.className = 'cp-meta';
      meta.textContent = agoStr(cp.ts);
      li.appendChild(main);
      li.appendChild(meta);
      li.addEventListener('click', function () {
        askConfirm({
          title: 'Jump back?',
          body: 'Return to "' + (cp.label || 'Checkpoint') +
                '". Your current progress will be overwritten.',
          confirmText: 'Jump back',
          cancelText: 'Stay here'
        }, function (yes) {
          if (!yes) return;
          closeCheckpoints();
          loadCheckpoint(cp);
          resumeAfterLoad();
        });
      });
      el.cpList.appendChild(li);
    });
  }
  function openCheckpoints() {
    if (!el.checkpointsOverlay) return;
    overlayOpen = true;
    renderCpList();
    el.checkpointsOverlay.hidden = false;
  }
  function closeCheckpoints() {
    overlayOpen = false;
    if (el.checkpointsOverlay) el.checkpointsOverlay.hidden = true;
  }

  /* ---------- settings ---------- */
  function openSettings() {
    overlayOpen = true;
    cancelAuto();
    el.setSpeed.value = settings.speed;
    el.setEffects.checked = settings.effects;
    el.setSkipSeen.checked = settings.skipSeen;
    if (el.setAutoDelay) el.setAutoDelay.value = settings.autoDelay;
    if (el.setSkipUnseen) el.setSkipUnseen.checked = settings.skipUnseen;
    if (A) {
      var as = A.getSettings();
      el.setMusicVol.value = Math.round(as.music * 100);
      el.setSfxVol.value = Math.round(as.sfx * 100);
      el.setMute.checked = as.muted;
    }
    el.settingsOverlay.hidden = false;
  }
  function closeSettings() {
    settings.speed = parseInt(el.setSpeed.value, 10) || 55;
    settings.effects = el.setEffects.checked;
    settings.skipSeen = el.setSkipSeen.checked;
    if (el.setAutoDelay) settings.autoDelay = parseInt(el.setAutoDelay.value, 10) || 1500;
    if (el.setSkipUnseen) settings.skipUnseen = el.setSkipUnseen.checked;
    saveSettings();
    overlayOpen = false;
    el.settingsOverlay.hidden = true;
  }
  if (A) {
    el.setMusicVol.addEventListener('input', function () { A.setMusic(this.value / 100); });
    el.setSfxVol.addEventListener('input', function () { A.setSfx(this.value / 100); });
    el.setMute.addEventListener('change', function () { A.setMuted(this.checked); });
  }

  /* ===========================================================
     SCREENS / NAVIGATION
     =========================================================== */
  function toTitle() {
    waiter = null; choicesOpen = false;
    clearInterval(typeTimer); typing = false;
    stopModes();
    stopVoice();
    if (A && A.stopAllFiles) A.stopAllFiles(0.2);
    if (A && A.crushMusic) A.crushMusic(false);
    document.body.classList.remove('fx-shake');
    el.choices.hidden = true;
    history = []; backlog = [];
    showScreen('title');
    refreshContinue();
  }
  function startNew() {
    el.firstName.value = '';
    el.lastName.value = '';
    el.nameError.textContent = '';
    showScreen('name');
    setTimeout(function () { el.firstName.focus(); }, 60);
  }
  function confirmName() {
    var f = el.firstName.value.trim();
    var l = el.lastName.value.trim();
    if (f.length < 1) { el.nameError.textContent = 'Enter at least a first name.'; el.firstName.focus(); return; }
    if (f.length > 24 || l.length > 28) { el.nameError.textContent = 'That is a bit long.'; return; }
    state = freshState();
    state.player.first = f;
    state.player.last = l;
    history = []; backlog = [];
    showScreen('vn');
    restoreStage();
    state.ptr = 0;
    step();
  }
  function doContinue() {
    if (!loadSave()) { refreshContinue(); return; }
    resumeAfterLoad();
  }
  function wipeSave() {
    if (!lsGet(SAVE_KEY) && !readCheckpoints().length) return;
    askConfirm({
      title: 'Erase save?',
      body: 'This deletes your save and every checkpoint. It cannot be undone.',
      confirmText: 'Erase everything',
      cancelText: 'Keep it',
      danger: true
    }, function (yes) {
      if (!yes) return;
      lsDel(SAVE_KEY);
      lsDel(CP_KEY);
      refreshContinue();
    });
  }

  /* ===========================================================
     INPUT
     =========================================================== */
  function advance() {
    if (overlayOpen) return;
    if (current.screen !== 'vn') return;
    if (choicesOpen) return;
    if (typing) { finishTyping(); return; }
    if (waiter === 'say') { cancelAuto(); waiter = null; step(); }
  }
  screens.vn.addEventListener('click', function (e) {
    if (e.target.closest('.vn-topbar') || e.target.closest('.choices')) return;
    advance();
  });

  // Keyboard: advance the line, pick a numbered choice, close an overlay.
  // Rollback / backlog / skip / auto are top-bar buttons only.
  document.addEventListener('keydown', function (e) {
    if (overlayOpen) {
      if (e.key === 'Escape') {
        if (el.compatOverlay && !el.compatOverlay.hidden) { /* force a choice */ }
        else if (el.backlogOverlay && !el.backlogOverlay.hidden) closeBacklog();
        else if (el.checkpointsOverlay && !el.checkpointsOverlay.hidden) closeCheckpoints();
        else closeSettings();
      }
      return;
    }
    if (current.screen === 'name') {
      if (e.key === 'Enter') confirmName();
      return;
    }
    if (current.screen !== 'vn') return;

    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      advance();
    } else if (choicesOpen && /^[1-9]$/.test(e.key)) {
      var btn = el.choices.children[parseInt(e.key, 10) - 1];
      if (btn) btn.click();
    }
  });

  el.titleMenu.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var a = b.getAttribute('data-action');
    if (!a || b.disabled) return;
    sfx(a === 'new' ? 'confirm' : 'click');
    if (a === 'new') startNew();
    else if (a === 'continue') doContinue();
    else if (a === 'checkpoints') openCheckpoints();
    else if (a === 'settings') openSettings();
    else if (a === 'wipe') wipeSave();
  });
  el.nameConfirm.addEventListener('click', function () { sfx('confirm'); confirmName(); });
  el.btnSave.addEventListener('click', function () { sfx('click'); manualCheckpoint(); });
  if (el.btnRollback) el.btnRollback.addEventListener('click', function () { sfx('click'); rollback(); });
  if (el.btnBacklog) el.btnBacklog.addEventListener('click', function () { sfx('click'); openBacklog(); });
  if (el.btnSkip) el.btnSkip.addEventListener('click', function () { sfx('click'); toggleSkip(); });
  if (el.btnAuto) el.btnAuto.addEventListener('click', function () { sfx('click'); toggleAuto(); });
  if (el.backlogClose) el.backlogClose.addEventListener('click', function () { sfx('click'); closeBacklog(); });
  if (el.cpClose) el.cpClose.addEventListener('click', function () { sfx('click'); closeCheckpoints(); });
  el.btnSettings.addEventListener('click', function () { sfx('click'); openSettings(); });
  el.btnQuit.addEventListener('click', function () {
    askConfirm({
      title: 'Return to menu?',
      body: 'Any progress since your last checkpoint will be lost.',
      confirmText: 'Return to menu',
      cancelText: 'Keep playing'
    }, function (yes) {
      if (yes) toTitle();
    });
  });
  el.settingsClose.addEventListener('click', function () { sfx('click'); closeSettings(); });
  el.endContinue.addEventListener('click', function () { sfx('confirm'); });

  if (el.compatResume) el.compatResume.addEventListener('click', function () {
    sfx('click'); closeCompat(); step();
  });
  if (el.compatRestart) el.compatRestart.addEventListener('click', function () {
    sfx('click');
    var info = el._compatInfo;
    closeCompat();
    if (info && info.label && LABELS[info.label] != null) { state.ptr = LABELS[info.label]; }
    step();
  });
  if (el.compatTitle) el.compatTitle.addEventListener('click', function () {
    sfx('back'); closeCompat(); toTitle();
  });

  /* ---------- audio unlock on first gesture + title music ---------- */
  function firstGesture() {
    document.removeEventListener('pointerdown', firstGesture, true);
    document.removeEventListener('keydown', firstGesture, true);
    if (!A) return;
    A.unlock();
    if (current.screen === 'title' || current.screen === 'name') {
      A.music('theme', { volume: 0.6, fade: 2.5 });
    }
  }
  document.addEventListener('pointerdown', firstGesture, true);
  document.addEventListener('keydown', firstGesture, true);

  /* ---------- start ---------- */
  validateScript();
  updateBadges();
  showScreen('title');
  refreshContinue();
})();
