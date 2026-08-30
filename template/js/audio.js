/* ===========================================================
   VNengine - audio engine.  Self-contained; can be lifted out
   and reused on its own.
   - Music: mp3 via WebAudio (crossfade, looping, offset).
   - Sound effects: synthesized on the fly, no files needed
     (plus an optional file bank, SfxBank).
   - One audio-processing effect kept as an example: crushMusic()
     (lo-fi band-pass on the music bus), reached from a script
     via  fx('crushmusic', { on: true|false }).
   - Volume settings persist in localStorage: 'vnengine_audio'.
   Autoplay policy requires a first user gesture -> VNAudio.unlock().
   =========================================================== */
window.VNAudio = (function () {
  'use strict';

  /* ===========================================================
     SfxBank - sounds loaded from AUDIO FILES (as opposed to the
     synthesized ones). Register name -> url, then play('name').
     Buffers are decoded once and cached. Routed through the sfx
     bus, so the "Sound volume" slider and "Mute" apply.
     =========================================================== */
  class SfxBank {
    constructor() {
      this._ctx = null;
      this._dest = null;        // VNAudio sfx bus
      this._urls = {};          // name -> url
      this._buffers = {};       // name -> AudioBuffer (cache)
      this._loops = {};         // name -> { src, gain }  - for stopping looped sounds
    }
    _bind(ctx, dest) { this._ctx = ctx; this._dest = dest; }

    /** register one sound */
    define(name, url) { this._urls[name] = url; return this; }
    /** register a batch: { name: url, ... } */
    defineMany(map) { var s = this; Object.keys(map || {}).forEach(function (n) { s.define(n, map[n]); }); return this; }
    has(name) { return !!this._urls[name]; }
    list() { return Object.keys(this._urls); }

    /** fetch + decode ahead of time (all registered names by default) */
    preload(names) {
      var s = this;
      (names || this.list()).forEach(function (n) { s.load(n).catch(function () {}); });
    }
    load(name) {
      if (this._buffers[name]) return Promise.resolve(this._buffers[name]);
      if (!this._ctx) return Promise.reject(new Error('no audio context yet'));
      var s = this, url = this._urls[name] || name;
      return fetch(url)
        .then(function (r) { if (!r.ok) throw new Error('sfx "' + name + '" ' + r.status); return r.arrayBuffer(); })
        .then(function (ab) { return new Promise(function (res, rej) { s._ctx.decodeAudioData(ab, res, rej); }); })
        .then(function (buf) { s._buffers[name] = buf; return buf; });
    }

    /**
     * Play a sound from a file.
     * opts: { volume=1, rate=1, detune=0, delay=0, loop=false }
     * Returns the name (for loop -> later sfxBank.stop(name)).
     */
    /** fallback: play through a plain <audio> element (file:// - fetch blocked) */
    _playEl(name, opts) {
      opts = opts || {};
      var url = this._urls[name] || name;
      try {
        var el = new Audio();
        el.src = url;
        el.volume = opts.volume == null ? 1 : Math.max(0, Math.min(1, opts.volume));
        if (opts.rate) el.playbackRate = opts.rate;
        el.loop = !!opts.loop;
        var p = el.play();
        if (p && p.catch) p.catch(function () {});
        if (opts.loop) this._loops[name] = { el: el };
      } catch (e) {}
      return name;
    }

    play(name, opts) {
      opts = opts || {};
      var s = this;
      if (!this._ctx || !this._dest) return this._playEl(name, opts);
      this.load(name).then(function (buf) {
        var g = s._ctx.createGain();
        g.gain.value = opts.volume == null ? 1 : opts.volume;
        g.connect(s._dest);
        var src = s._ctx.createBufferSource();
        src.buffer = buf;
        if (opts.rate) src.playbackRate.value = opts.rate;
        if (opts.detune && src.detune) src.detune.value = opts.detune;
        src.loop = !!opts.loop;
        src.connect(g);
        src.start(s._ctx.currentTime + (opts.delay || 0));
        if (opts.loop) {
          if (s._loops[name]) { try { s._loops[name].src.stop(); } catch (e) {} }
          s._loops[name] = { src: src, gain: g };
        } else {
          src.onended = function () { try { src.disconnect(); g.disconnect(); } catch (e) {} };
        }
      }).catch(function () { s._playEl(name, opts); });   // fetch failed (file://) - plain <audio>
      return name;
    }

    /** stop a looped sound (with a short fade) */
    stop(name, fade) {
      var l = this._loops[name];
      if (l && l.el) { try { l.el.pause(); l.el.removeAttribute('src'); l.el.load(); } catch (e) {} delete this._loops[name]; return; }
      if (!l || !this._ctx) return;
      var t = this._ctx.currentTime, f = fade == null ? 0.15 : fade;
      try {
        l.gain.gain.setValueAtTime(Math.max(0.0001, l.gain.gain.value), t);
        l.gain.gain.linearRampToValueAtTime(0.0001, t + f);
        l.src.stop(t + f + 0.03);
      } catch (e) {}
      delete this._loops[name];
    }
    stopAll(fade) { var s = this; Object.keys(this._loops).forEach(function (n) { s.stop(n, fade); }); }
  }

  var sfxBank = new SfxBank();

  // name -> file.  Reference from a script with  music('theme').
  // A missing file just plays nothing.
  var MUSIC = {
    theme: 'src/audio/music/theme.mp3'
  };
  // Optional named time marks inside tracks (seconds), for music(name,{offset}).
  var MARKS = {};

  var SET_KEY = 'vnengine_audio';
  var settings = { master: 0.9, music: 0.65, sfx: 0.8, muted: false };
  (function load() {
    try {
      var s = JSON.parse(localStorage.getItem(SET_KEY));
      if (s) ['master', 'music', 'sfx'].forEach(function (k) {
        if (typeof s[k] === 'number') settings[k] = s[k];
      });
      if (s && typeof s.muted === 'boolean') settings.muted = s.muted;
    } catch (e) {}
  })();
  function persist() { try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch (e) {} }

  // MediaElementSource is only reliable over http(s). On file:// (opening
  // index.html with a double-click) fetch is blocked and Chrome's
  // createMediaElementSource returns silence - so there we play music
  // straight through an <audio> element.
  var USE_GRAPH = (typeof location === 'undefined') || location.protocol !== 'file:';

  var ctx = null, master = null, musicBus = null, sfxBus = null, musicFilter = null;
  var cur = null;            // current music: { name, el, opts, base, gain|null, node|null, _duck, _volIv, _bendIv }
  var _warm = [];            // warmed <audio> elements, kept from GC until first play
  var unlocked = false;
  var pending = null;        // music requested before unlock
  var musicCrushed = false;

  function ensureCtx() {
    if (ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    musicBus = ctx.createGain();
    sfxBus = ctx.createGain();
    // music runs through a filter (transparent by default) - for crushMusic()
    musicFilter = ctx.createBiquadFilter();
    musicFilter.type = 'allpass';
    musicBus.connect(musicFilter);
    musicFilter.connect(master);
    sfxBus.connect(master);
    master.connect(ctx.destination);
    sfxBank._bind(ctx, sfxBus);       // file sounds -> sfx bus
    applyVolumes();
  }

  function applyVolumes() {
    if (!ctx) return;
    var t = ctx.currentTime;
    master.gain.setTargetAtTime(settings.muted ? 0 : settings.master, t, 0.02);
    musicBus.gain.setTargetAtTime(settings.music, t, 0.02);
    sfxBus.gain.setTargetAtTime(settings.sfx, t, 0.02);
    // direct path (file://): music volume lives on the <audio> element
    if (cur && !cur.gain && cur.el) { try { cur.el.volume = musicElVolume(cur); } catch (e) {} }
  }
  // final <audio> volume for the direct-playback path
  function musicElVolume(entry) {
    return (settings.muted ? 0 : 1) * clamp01(settings.master) * clamp01(settings.music) *
           (entry.base == null ? 1 : entry.base) * (entry._duck == null ? 1 : entry._duck);
  }
  function rampEl(entry, to, sec, done) {
    if (!entry || !entry.el) { if (done) done(); return; }
    if (entry._volIv) { clearInterval(entry._volIv); entry._volIv = null; }
    var from = entry.el.volume, steps = Math.max(1, Math.round((sec || 0.5) * 60)), i = 0;
    entry._volIv = setInterval(function () {
      i++;
      var v = from + (to - from) * (i / steps);
      try { entry.el.volume = Math.max(0, Math.min(1, v)); } catch (e) {}
      if (i >= steps) { clearInterval(entry._volIv); entry._volIv = null; if (done) done(); }
    }, 1000 / 60);
  }

  function unlock() {
    ensureCtx();
    if (ctx.state === 'suspended') ctx.resume();
    if (unlocked) return;
    unlocked = true;
    // warm up the music (just ask the browser to start downloading the files)
    Object.keys(MUSIC).forEach(function (n) {
      try { var a = new Audio(); a.preload = 'auto'; a.src = MUSIC[n]; _warm.push(a); } catch (e) {}
    });
    // pick up the declarative file-sound list from VNData.SFX_FILES
    if (window.VNData && window.VNData.SFX_FILES) sfxBank.defineMany(window.VNData.SFX_FILES);
    sfxBank.preload();
    if (pending) { var p = pending; pending = null; playMusic(p.name, p.opts); }
  }

  /* ---------------- MUSIC ---------------- */
  // Stop and tear down a music entry (graph or direct <audio>).
  function disposeEntry(entry, fade) {
    if (!entry) return;
    if (entry._bendIv) { clearInterval(entry._bendIv); entry._bendIv = null; }
    if (entry._volIv) { clearInterval(entry._volIv); entry._volIv = null; }
    var el = entry.el;
    var kill = function () {
      try { el.pause(); } catch (e) {}
      try { el.removeAttribute('src'); el.load(); } catch (e) {}
      try { if (entry.node) entry.node.disconnect(); if (entry.gain) entry.gain.disconnect(); } catch (e) {}
    };
    if (entry.gain && ctx) {
      rampGain(entry.gain.gain, 0.0001, fade);
      setTimeout(kill, Math.max(60, (fade + 0.1) * 1000));
    } else {
      rampEl(entry, 0, fade, kill);
    }
  }

  function playMusic(name, opts) {
    opts = opts || {};
    if (!unlocked) { pending = { name: name, opts: opts }; return; }
    ensureCtx();
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }

    if (cur && cur.name === name && !opts.restart) {
      // same track already playing - just adjust the volume
      var f = opts.fade != null ? opts.fade : 0.6;
      if (opts.volume != null) {
        cur.base = opts.volume;
        if (cur.gain) rampGain(cur.gain.gain, opts.volume, f);
        else rampEl(cur, musicElVolume(cur), f);
      }
      return;
    }

    var fade = opts.fade != null ? opts.fade : 0.8;
    if (cur) { disposeEntry(cur, fade); cur = null; }

    var el = new Audio();
    el.preload = 'auto';
    el.loop = opts.loop !== false;
    if (opts.rate) el.playbackRate = opts.rate;
    el.src = MUSIC[name] || name;

    var target = opts.volume != null ? opts.volume : 1;
    var entry = { name: name, el: el, opts: opts, base: target,
                  gain: null, node: null, _duck: 1, _volIv: null, _bendIv: null, _started: false };

    if (USE_GRAPH) {
      try {
        var node = ctx.createMediaElementSource(el);
        var g = ctx.createGain();
        g.gain.value = 0.0001;
        node.connect(g); g.connect(musicBus);
        entry.node = node; entry.gain = g;
      } catch (e) { entry.gain = null; entry.node = null; }
    }
    cur = entry;

    var startAt = Math.max(0, opts.offset || 0);
    var fadeIn = opts.fadeIn != null ? opts.fadeIn : fade;
    var begin = function () {
      if (entry._started || cur !== entry) return;
      entry._started = true;
      try { if (startAt) el.currentTime = startAt; } catch (e) {}
      var pr = el.play();
      if (pr && pr.catch) pr.catch(function () { setTimeout(function () { try { el.play(); } catch (e) {} }, 80); });
      if (entry.gain) {
        var t0 = ctx.currentTime;
        entry.gain.gain.setValueAtTime(0.0001, t0);
        entry.gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, target), t0 + Math.max(0.02, fadeIn));
      } else {
        el.volume = 0.0001;
        rampEl(entry, musicElVolume(entry), fadeIn);
      }
    };

    el.addEventListener('error', function () { /* no file - silence */ }, { once: true });
    if (el.readyState >= 1) begin();
    else {
      el.addEventListener('loadedmetadata', begin, { once: true });
      el.addEventListener('canplay', begin, { once: true });
      setTimeout(begin, 1600);   // safety net if the events never fire
    }
  }

  function stopMusic(opts) {
    opts = opts || {};
    pending = null;
    if (!cur) return;
    disposeEntry(cur, opts.fade != null ? opts.fade : 0.8);
    cur = null;
  }

  // dip the music under a line / stinger, then bring it back
  function duck(amount, ms) {
    if (!cur) return;
    amount = amount == null ? 0.6 : amount;
    var dur = (ms || 500) / 1000;
    if (cur.gain && ctx) {
      var g = cur.gain.gain, now = ctx.currentTime, base = cur.base || 1;
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(0.0001, g.value), now);
      g.linearRampToValueAtTime(Math.max(0.0001, base * (1 - amount)), now + 0.06);
      g.linearRampToValueAtTime(Math.max(0.0001, base), now + 0.06 + dur);
    } else {
      var e = cur;
      e._duck = (1 - amount);
      rampEl(e, musicElVolume(e), 0.08, function () {
        setTimeout(function () {
          if (cur === e) { e._duck = 1; rampEl(e, musicElVolume(e), dur); }
        }, dur * 1000);
      });
    }
  }

  function rampGain(param, to, sec) {
    if (!ctx) return;
    var now = ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(Math.max(0.0001, param.value), now);
    param.exponentialRampToValueAtTime(Math.max(0.0001, to), now + Math.max(0.02, sec || 0.6));
  }

  /* ---------------- SOUND EFFECTS (synthesized) ---------------- */
  function noiseBuffer(dur) {
    var n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  function blip(type, f0, f1, t0, dur, peak, dest) {
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 != null) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest || sfxBus);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }
  function noiseHit(t0, dur, peak, filterType, freq, q, dest) {
    var s = ctx.createBufferSource();
    s.buffer = noiseBuffer(dur + 0.05);
    var f = ctx.createBiquadFilter();
    f.type = filterType || 'bandpass';
    f.frequency.value = freq || 1200;
    if (q != null) f.Q.value = q;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(dest || sfxBus);
    s.start(t0); s.stop(t0 + dur + 0.05);
  }

  var SFX = {
    click: function (t) { blip('triangle', 1250, 720, t, 0.05, 0.18); noiseHit(t, 0.03, 0.06, 'highpass', 3000); },
    hover: function (t) { blip('sine', 560, 760, t, 0.04, 0.05); },
    confirm: function (t) { blip('triangle', 523, 523, t, 0.09, 0.16); blip('triangle', 784, 784, t + 0.07, 0.12, 0.16); },
    back: function (t) { blip('triangle', 640, 360, t, 0.14, 0.14); },
    choice: function (t) { blip('sine', 470, 470, t, 0.11, 0.12); blip('sine', 700, 700, t + 0.02, 0.1, 0.06); },
    step: function (t) {
      var j = (Math.random() - 0.5) * 60;
      noiseHit(t, 0.09, 0.13, 'lowpass', 420 + j, 6);
      blip('sine', 120 + j, 70, t, 0.06, 0.05);
    },
    type: function (t) { blip('square', 2100, 2100, t, 0.012, 0.015); },
    error: function (t) { blip('sawtooth', 150, 120, t, 0.2, 0.14); blip('square', 90, 80, t, 0.22, 0.08); },
    glitch: function (t) {
      for (var i = 0; i < 5; i++) {
        var tt = t + i * (0.02 + Math.random() * 0.03);
        noiseHit(tt, 0.03 + Math.random() * 0.05, 0.12, 'bandpass',
          400 + Math.random() * 3600, 12 + Math.random() * 20);
      }
      blip('square', 900 + Math.random() * 400, 120, t, 0.16, 0.1);
    },
    stinger: function (t) {
      blip('sine', 70, 42, t, 0.9, 0.28);
      var s = ctx.createBufferSource();
      s.buffer = noiseBuffer(0.7);
      var f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.setValueAtTime(200, t);
      f.frequency.exponentialRampToValueAtTime(2600, t + 0.6); f.Q.value = 3;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
      s.connect(f); f.connect(g); g.connect(sfxBus);
      s.start(t); s.stop(t + 0.8);
    },

    /* --- darker tones --- */
    boom: function (t) {
      blip('sine', 90, 32, t, 1.1, 0.5);            // sub hit
      blip('triangle', 180, 55, t, 0.5, 0.32);
      noiseHit(t, 0.5, 0.28, 'lowpass', 260, 2);    // body
      noiseHit(t + 0.01, 0.06, 0.3, 'highpass', 5000); // attack
    },
    heartbeat: function (t) {
      blip('sine', 62, 40, t, 0.16, 0.34);
      blip('sine', 58, 36, t + 0.24, 0.2, 0.26);
    },
    riser: function (t) {
      var o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(120, t);
      o.frequency.exponentialRampToValueAtTime(2400, t + 1.6);
      var f = ctx.createBiquadFilter(); f.type = 'lowpass';
      f.frequency.setValueAtTime(300, t);
      f.frequency.exponentialRampToValueAtTime(6000, t + 1.6);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.16, t + 1.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
      o.connect(f); f.connect(g); g.connect(sfxBus);
      o.start(t); o.stop(t + 2);
    },
    whisper: function (t) {
      var s = ctx.createBufferSource(); s.buffer = noiseBuffer(0.9);
      var f = ctx.createBiquadFilter(); f.type = 'bandpass';
      f.frequency.value = 1500 + Math.random() * 900; f.Q.value = 8;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.3);
      g.gain.linearRampToValueAtTime(0.0001, t + 0.85);
      s.connect(f); f.connect(g); g.connect(sfxBus);
      s.start(t); s.stop(t + 0.95);
    },
    staticNoise: function (t) {
      var dur = 0.4;
      var s = ctx.createBufferSource(); s.buffer = noiseBuffer(dur + 0.05);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.22, t);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      s.connect(g); g.connect(sfxBus);
      s.start(t); s.stop(t + dur + 0.05);
    },
    // harsh screech
    screech: function (t) {
      var o1 = ctx.createOscillator(); o1.type = 'sawtooth';
      o1.frequency.setValueAtTime(1800, t);
      o1.frequency.exponentialRampToValueAtTime(320, t + 0.9);
      var o2 = ctx.createOscillator(); o2.type = 'square';
      o2.frequency.setValueAtTime(2500, t);
      o2.frequency.exponentialRampToValueAtTime(600, t + 0.9);
      var ns = ctx.createBufferSource(); ns.buffer = noiseBuffer(1.1);
      var f = ctx.createBiquadFilter(); f.type = 'bandpass';
      f.frequency.setValueAtTime(900, t);
      f.frequency.exponentialRampToValueAtTime(3200, t + 0.5);
      f.Q.value = 6;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.34, t + 0.03);
      g.gain.setValueAtTime(0.34, t + 0.72);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);
      o1.connect(f); o2.connect(f); ns.connect(f); f.connect(g); g.connect(sfxBus);
      o1.start(t); o2.start(t); ns.start(t);
      o1.stop(t + 1.1); o2.stop(t + 1.1); ns.stop(t + 1.1);
    }
  };

  // Unified call: synthesized sound first, otherwise a file from SfxBank.
  function sfx(name, opts) {
    opts = opts || {};
    if (!unlocked || !ctx || settings.muted) return;
    var times = opts.times || 1;
    var interval = opts.interval || 240;
    for (var i = 0; i < times; i++) {
      (function (i) {
        setTimeout(function () {
          if (!ctx) return;
          if (SFX[name]) SFX[name](ctx.currentTime + 0.001);
          else if (sfxBank.has(name)) sfxBank.play(name, opts);
        }, i * interval);
      })(i);
    }
  }

  function registerSfx(name, url) { sfxBank.define(name, url); }

  /* ---------------- AUDIO EFFECT (example) ---------------- */
  // Lo-fi "crush" on the music: band-pass + Q on the music bus.
  // This is the one audio-processing effect kept as a worked example;
  // a script triggers it with  fx('crushmusic', { on: true|false }).
  function crushMusic(on) {
    if (!ctx || !musicFilter) return;
    var t = ctx.currentTime;
    if (on && !musicCrushed) {
      musicCrushed = true;
      musicFilter.type = 'bandpass';
      musicFilter.frequency.setTargetAtTime(650, t, 0.3);
      musicFilter.Q.setTargetAtTime(6, t, 0.3);
    } else if (!on && musicCrushed) {
      musicCrushed = false;
      musicFilter.frequency.setTargetAtTime(12000, t, 0.3);
      musicFilter.Q.setTargetAtTime(0.0001, t, 0.3);
      setTimeout(function () { if (!musicCrushed && musicFilter) musicFilter.type = 'allpass'; }, 400);
    }
  }
  /* ---------------- SETTINGS ---------------- */
  function setMaster(v) { settings.master = clamp01(v); applyVolumes(); persist(); }
  function setMusic(v) { settings.music = clamp01(v); applyVolumes(); persist(); }
  function setSfx(v) { settings.sfx = clamp01(v); applyVolumes(); persist(); }
  function setMuted(b) { settings.muted = !!b; applyVolumes(); persist(); }
  function getSettings() { return Object.assign({}, settings); }
  function clamp01(v) { v = parseFloat(v); return isNaN(v) ? 0 : Math.max(0, Math.min(1, v)); }

  return {
    unlock: unlock,
    music: playMusic,
    stopMusic: stopMusic,
    duck: duck,
    sfx: sfx,

    // --- file sounds (SfxBank) ---
    sfxBank: sfxBank,                                   // the bank object itself
    registerSfx: registerSfx,                           // define(name, url)
    registerSfxMany: function (map) { sfxBank.defineMany(map); },
    preloadSfx: function (names) { sfxBank.preload(names); },
    playFile: function (name, opts) { return sfxBank.play(name, opts); },
    stopFile: function (name, fade) { sfxBank.stop(name, fade); },
    stopAllFiles: function (fade) { sfxBank.stopAll(fade); },

    // --- audio effect (example) ---
    crushMusic: crushMusic,

    setMaster: setMaster,
    setMusic: setMusic,
    setSfx: setSfx,
    setMuted: setMuted,
    getSettings: getSettings,
    MUSIC: MUSIC,
    MARKS: MARKS
  };
})();
