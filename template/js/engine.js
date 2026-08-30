/* ===========================================================
   VNengine - core runtime.  Vanilla JS, no build step.
   Runs from a local server (playtest.py) or straight from
   file:// by double-clicking index.html.

   Reads:
     window.VNData   - backgrounds / characters      (js/data.js)
     window.VNScript - the script: { ops: [...] }     (js/story.js)
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
   'choices', 'btnSave', 'btnSettings', 'btnQuit',
   'endTitle', 'endContinue', 'settingsOverlay', 'setSpeed', 'setEffects', 'setSkipSeen',
   'setMusicVol', 'setSfxVol', 'setMute',
   'checkpointsOverlay', 'cpList', 'cpClose', 'settingsClose'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

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

  /* ---------- state ---------- */
  function freshState() {
    return {
      ptr: 0,
      vars: {},
      player: { first: '', last: '' },
      seen: {},
      stage: { bg: 'black', sprites: {} }
    };
  }
  var state = freshState();
  var current = { screen: 'title' };
  var typing = false, typeTimer = null, fullHTML = '', waiter = null;
  var choicesOpen = false, overlayOpen = false;

  /* ---------- labels ---------- */
  var LABELS = {};
  SC.ops.forEach(function (op, i) { if (op.op === 'label') LABELS[op.name] = i; });

  /* ---------- localStorage ---------- */
  var SAVE_KEY = 'vnengine_save', SET_KEY = 'vnengine_settings', CP_KEY = 'vnengine_checkpoints';
  var CP_CAP = 30;
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function clone(o) { try { return JSON.parse(JSON.stringify(o || {})); } catch (e) { return {}; } }

  var settings = { speed: 55, effects: true, skipSeen: false };
  (function loadSettings() {
    var s = lsGet(SET_KEY);
    if (s) {
      if (typeof s.speed === 'number') settings.speed = s.speed;
      if (typeof s.effects === 'boolean') settings.effects = s.effects;
      if (typeof s.skipSeen === 'boolean') settings.skipSeen = s.skipSeen;
    }
  })();
  function saveSettings() { lsSet(SET_KEY, settings); }

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

  var POS_ORDER = { left: 0, center: 1, right: 2 };
  function spriteSrc(ch, expr) {
    var s = ch.sprites || {};
    return s[expr] || s.idle || '';
  }
  function makePlaceholderSprite(ch, id) {
    var node = document.createElement('div');
    node.className = 'sprite sprite--ph is-shown';
    node.style.setProperty('--ph-color', ch.color || '#ffd9ec');
    node.innerHTML = '<span class="ph-name">' + (ch.name || id) + '</span>' +
                     '<span class="ph-note">no sprite</span>';
    return node;
  }
  function renderSprites() {
    el.sprites.innerHTML = '';
    Object.keys(state.stage.sprites).forEach(function (id) {
      var s = state.stage.sprites[id];
      var ch = D.CHARACTERS[id];
      if (!ch) return;
      var src = spriteSrc(ch, s.expr);
      var node;
      if (src) {
        node = document.createElement('img');
        node.className = 'sprite is-shown';
        node.src = src;
        node.addEventListener('error', function () {
          if (this.parentNode !== el.sprites) return;
          var ph = makePlaceholderSprite(ch, id);
          ph.setAttribute('data-pos', this.getAttribute('data-pos'));
          ph.setAttribute('data-id', id);
          el.sprites.replaceChild(ph, this);
        });
      } else {
        node = makePlaceholderSprite(ch, id);
      }
      node.setAttribute('data-pos', s.pos);
      node.setAttribute('data-id', id);
      el.sprites.appendChild(node);
    });
    [].slice.call(el.sprites.children)
      .sort(function (a, b) {
        return POS_ORDER[a.getAttribute('data-pos')] - POS_ORDER[b.getAttribute('data-pos')];
      })
      .forEach(function (n) { el.sprites.appendChild(n); });
  }
  function stageShow(id, expr, pos) {
    state.stage.sprites[id] = { expr: expr || 'idle', pos: pos || 'center' };
    renderSprites();
  }
  function stageHide(id) {
    delete state.stage.sprites[id];
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
    setBg(state.stage.bg || 'black');
    renderSprites();
  }

  /* ===========================================================
     TEXT
     =========================================================== */
  function fmt(t) {
    var first = state.player.first || 'Player';
    var last = state.player.last || '';
    t = String(t)
      .replace(/\{first\}/g, first)
      .replace(/\{last\}/g, last)
      .replace(/\{name\}/g, (first + ' ' + last).trim());
    var div = document.createElement('div');
    div.textContent = t;
    return div.innerHTML;
  }
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
      if (typeof v === 'number') state.vars[k] = (state.vars[k] || 0) + v;
      else state.vars[k] = v;
    });
  }
  function asyncNext(ms) { setTimeout(step, ms); return 'async'; }

  function step() {
    while (true) {
      if (state.ptr >= SC.ops.length) { toTitle(); return; }
      var c = SC.ops[state.ptr++];
      var r = exec(c);
      if (r === 'wait' || r === 'async') return;
    }
  }

  function exec(c) {
    switch (c.op) {
      case 'label':     return 'go';
      case 'jump':      state.ptr = LABELS[c.to]; return 'go';
      case 'if':        if (c.cond(state)) state.ptr = LABELS[c.to]; return 'go';
      case 'set':       applySet(c.vars); return 'go';
      case 'scene':     setBg(c.bg); return asyncNext(280);
      case 'pause':     return asyncNext(c.ms || 300);
      case 'show':      stageShow(c.who, c.expr, c.pos); return 'go';
      case 'hide':      stageHide(c.who); return 'go';
      case 'say':       doSay(c); return 'wait';
      case 'choice':    doChoice(c); return 'wait';
      case 'music':     if (A) A.music(c.name, c.opts); return 'go';
      case 'stopMusic': if (A) A.stopMusic(c.opts); return 'go';
      case 'sfx':       sfx(c.name, c.opts); return 'go';
      case 'sfxStop':   if (A && A.stopFile) A.stopFile(c.name, c.fade); return 'go';
      case 'duck':      if (A) A.duck(c.amount, c.ms); return 'go';
      case 'fx':        runFx(c); return 'go';
      case 'save':      pushCheckpoint(c.label || null); return 'go';
      case 'chapterEnd': doChapterEnd(c); return 'async';
      case 'toTitle':   toTitle(); return 'wait';
    }
    return 'go';
  }

  function doSay(c) {
    var here = state.ptr - 1;
    var who = c.who;
    var ch = who && D.CHARACTERS[who];
    var nm = '';
    if (who === 'mc') nm = state.player.first || 'Player';
    else if (ch) nm = ch.name;
    el.nameBox.textContent = nm;
    el.nameBox.style.background = ch ? '' : (who === 'mc' ? '#7a3d63' : '');

    if (ch && c.expr && state.stage.sprites[who]) {
      state.stage.sprites[who].expr = c.expr;
      renderSprites();
    }
    highlight(ch ? who : null);

    waiter = 'say';
    var instant = !!(settings.skipSeen && state.seen[here]);
    state.seen[here] = 1;
    typeText(fmt(c.text), instant);
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
    choicesOpen = true;
    waiter = null;
    renderChoiceButtons(c.options, function (i) { pickChoice(c.options[i]); });
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

  /* ---------- chapter end ---------- */
  function doChapterEnd(c) {
    if (A && A.stopAllFiles) A.stopAllFiles(0.3);
    if (A && A.crushMusic) A.crushMusic(false);
    document.body.classList.remove('fx-shake');
    var here = state.ptr - 1;
    // checkpoint that resumes at the start of the next chapter (or here, if none)
    var nextPtr = (c.next != null && LABELS[c.next] != null) ? LABELS[c.next] : here;
    state.ptr = nextPtr;
    pushCheckpoint(fmt(c.title || 'End of chapter'), { isChapterEnd: true });
    state.ptr = here;
    lsSet(SAVE_KEY, { v: 1, ptr: here, vars: clone(state.vars), player: clone(state.player),
                      seen: clone(state.seen), stage: clone(state.stage) });
    refreshContinue();
    el.endTitle.textContent = fmt(c.title || 'End of chapter');
    showScreen('end');
    sfx('stinger');
    el.endContinue.onclick = function () {
      if (c.next != null && LABELS[c.next] != null) {
        state.ptr = LABELS[c.next];
        showScreen('vn');
        restoreStage();
        step();
      } else {
        toTitle();
      }
    };
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
      document.getElementById('game').appendChild(d);
      setTimeout(function () { d.remove(); }, c.ms || 260);
    }
  }

  /* ===========================================================
     SAVE / CHECKPOINTS
     =========================================================== */
  function readCheckpoints() {
    var a = lsGet(CP_KEY);
    return (a && a.length) ? a : [];
  }
  function segmentNameAt(ptr) {
    var best = null, bestIdx = -1;
    Object.keys(LABELS).forEach(function (nm) {
      var i = LABELS[nm];
      if (i <= ptr && i > bestIdx) { bestIdx = i; best = nm; }
    });
    return best || '';
  }
  function pushCheckpoint(label, opts) {
    opts = opts || {};
    var ptr = (opts.ptr != null) ? opts.ptr : state.ptr;
    var cp = {
      id: 'cp' + Date.now().toString(36) + '_' + ((Math.random() * 1e6) | 0).toString(36),
      label: label || segmentNameAt(ptr) || 'Autosave',
      isChapterEnd: !!opts.isChapterEnd,
      ts: Date.now(),
      ptr: ptr,
      vars: clone(state.vars),
      player: clone(state.player),
      seen: clone(state.seen),
      stage: clone(state.stage)
    };
    var list = readCheckpoints();
    list.push(cp);
    while (list.length > CP_CAP) {
      var idx = -1;
      for (var i = 0; i < list.length; i++) { if (!list[i].isChapterEnd) { idx = i; break; } }
      if (idx < 0) break;
      list.splice(idx, 1);
    }
    lsSet(CP_KEY, list);
    lsSet(SAVE_KEY, { v: 1, ptr: cp.ptr, vars: cp.vars, player: cp.player, seen: cp.seen, stage: cp.stage });
    refreshContinue();
    return cp;
  }
  function applySnapshot(s) {
    state = freshState();
    state.ptr = s.ptr || 0;
    state.vars = s.vars || {};
    state.player = s.player || { first: '', last: '' };
    state.seen = s.seen || {};
    state.stage = s.stage || { bg: 'black', sprites: {} };
    if (!state.stage.sprites) state.stage.sprites = {};
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
    lsSet(SAVE_KEY, { v: 1, ptr: cp.ptr, vars: cp.vars, player: cp.player, seen: cp.seen, stage: cp.stage });
    refreshContinue();
    return true;
  }
  function refreshContinue() {
    el.btnContinue.disabled = !lsGet(SAVE_KEY);
    if (el.btnCheckpoints) el.btnCheckpoints.disabled = !readCheckpoints().length;
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
  function manualCheckpoint() {
    pushCheckpoint('Manual - ' + (segmentNameAt(state.ptr) || 'save'));
    var prev = el.btnSave.textContent;
    el.btnSave.textContent = '✓';
    setTimeout(function () { el.btnSave.textContent = prev; }, 800);
    toast('Checkpoint saved');
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
        if (!window.confirm('Jump back to "' + (cp.label || 'Checkpoint') + '"? Current progress is overwritten.')) return;
        sfx('confirm');
        closeCheckpoints();
        loadCheckpoint(cp);
        showScreen('vn');
        restoreStage();
        step();
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
    el.setSpeed.value = settings.speed;
    el.setEffects.checked = settings.effects;
    el.setSkipSeen.checked = settings.skipSeen;
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
    if (A && A.stopAllFiles) A.stopAllFiles(0.2);
    if (A && A.crushMusic) A.crushMusic(false);
    document.body.classList.remove('fx-shake');
    el.choices.hidden = true;
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
    showScreen('vn');
    restoreStage();
    state.ptr = 0;
    step();
  }
  function doContinue() {
    if (!loadSave()) { refreshContinue(); return; }
    showScreen('vn');
    restoreStage();
    step();
  }
  function wipeSave() {
    if (!lsGet(SAVE_KEY) && !readCheckpoints().length) return;
    if (!window.confirm('Erase the save and every checkpoint? This cannot be undone.')) return;
    lsDel(SAVE_KEY);
    lsDel(CP_KEY);
    refreshContinue();
  }

  /* ===========================================================
     INPUT
     =========================================================== */
  function advance() {
    if (overlayOpen) return;
    if (current.screen !== 'vn') return;
    if (choicesOpen) return;
    if (typing) { finishTyping(); return; }
    if (waiter === 'say') { waiter = null; step(); }
  }
  screens.vn.addEventListener('click', function (e) {
    if (e.target.closest('.vn-topbar') || e.target.closest('.choices')) return;
    advance();
  });
  document.addEventListener('keydown', function (e) {
    if (overlayOpen) {
      if (e.key === 'Escape') {
        if (el.checkpointsOverlay && !el.checkpointsOverlay.hidden) closeCheckpoints();
        else closeSettings();
      }
      return;
    }
    if (current.screen === 'name') {
      if (e.key === 'Enter') confirmName();
      return;
    }
    if (current.screen === 'vn') {
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        advance();
      } else if (choicesOpen && /^[1-9]$/.test(e.key)) {
        var btn = el.choices.children[parseInt(e.key, 10) - 1];
        if (btn) btn.click();
      }
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
  if (el.cpClose) el.cpClose.addEventListener('click', function () { sfx('click'); closeCheckpoints(); });
  el.btnSettings.addEventListener('click', function () { sfx('click'); openSettings(); });
  el.btnQuit.addEventListener('click', function () {
    sfx('back');
    if (!window.confirm('Return to the menu? Unsaved progress is lost.')) return;
    toTitle();
  });
  el.settingsClose.addEventListener('click', function () { sfx('click'); closeSettings(); });
  el.endContinue.addEventListener('click', function () { sfx('confirm'); });

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
  showScreen('title');
  refreshContinue();
})();
