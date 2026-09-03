/* ===========================================================
   VNengine - script helpers, shared by every chapter file.

   These build the op objects your chapter files (js/story/chapter1.js,
   js/story/chapter2.js, ...) use to write the story. Load this file once,
   before any chapterN.js - the engine never reads it directly.

   See js/story/README.md for the full guide to adding and editing chapters.

   Text tokens:  {first} {last} {name}  -> the player's name
                 {anyVar}             -> a value from set({ ... })
   Text markup:  [b]bold[/b]  [i]italic[/i]  [c=#ff8ec4]colour[/c]
   =========================================================== */
(function (global) {
  'use strict';

  /* ---- op builders -------------------------------------------------- */
  // say(who, text, expr, voice) - `voice` is an optional SfxBank file name
  // (register it in VNData.SFX_FILES) played while the line is on screen.
  function say(who, text, expr, voice) { return { op: 'say', who: who, text: text, expr: expr, voice: voice }; }
  function narr(text)           { return { op: 'say', who: null, text: text }; }   // narration
  function mc(text)             { return { op: 'say', who: 'mc', text: text }; }    // player's own voice
  function bg(name)             { return { op: 'scene', bg: name }; }
  // `where` for show/move is a position NAME ('left' | 'center' | 'right' |
  // any name from VNData.POSITIONS) OR an options object.  An options object
  // (as `where`, or as an extra 4th/3rd arg after a name) may carry:
  //   pos        a position name
  //   x, y       inline coords - x = sprite centre (share of stage width),
  //              y = lift off the floor (positive = up)
  //   scale      sprite size, 100 = normal; overrides / adds to the name's
  //   transition show/hide: 'fade' (default) | 'rise' | 'slide-left' | 'slide-right'
  //              move:      'glide' (default) | 'linear' | 'ease-in' | 'ease-out'
  //   duration   ms for the transition / glide (show/hide default 300; 0 = snap)
  function placement(where, opts) {
    var w = (where && typeof where === 'object') ? where : {};
    var o = opts || {};
    var pick = function (k) { return o[k] != null ? o[k] : w[k]; };
    return {
      pos: (typeof where === 'string' ? where : w.pos) || null,
      x: pick('x'), y: pick('y'), scale: pick('scale'),
      transition: pick('transition'), duration: pick('duration')
    };
  }
  // show(who, expr, 'left')  /  show(who, expr, { pos:'left', scale:120 })
  //   /  show(who, expr, 'left', { scale:120, transition:'rise' })
  function show(who, expr, where, opts) {
    var p = placement(where, opts);
    return {
      op: 'show', who: who, expr: expr || 'idle',
      pos: p.pos || 'center', x: p.x, y: p.y, scale: p.scale,
      transition: p.transition, duration: p.duration
    };
  }
  // hide(who) or hide(who, { transition, duration }) - same transition names
  // as show; the character exits that way instead of a plain fade.
  function hide(who, opts) {
    opts = opts || {};
    return { op: 'hide', who: who, transition: opts.transition, duration: opts.duration };
  }
  // move(who, dest[, opts]) - reposition an already-shown character WITHOUT
  // hide/show.  `dest` is a name or an options object; `opts` is an optional
  // extra object when `dest` is a name.  duration (ms) smooths the glide -
  // x, y AND scale all animate together; absent or 0 = instant jump.  Does
  // not pause the script - use pause(ms) to wait for it.
  function move(who, dest, opts) {
    var p = placement(dest, opts);
    return {
      op: 'move', who: who,
      pos: p.pos, x: p.x, y: p.y, scale: p.scale,
      transition: p.transition, duration: p.duration
    };
  }
  function label(name)          { return { op: 'label', name: name }; }
  function jump(to)             { return { op: 'jump', to: to }; }
  function iff(cond, to)        { return { op: 'if', cond: cond, to: to }; }
  function set(vars)            { return { op: 'set', vars: vars }; }
  function abs(n)               { return { __set: n }; }   // set({ gold: abs(0) }) assigns instead of adding
  // choice([ { text, to, set, show } ]) - `show` is an optional s => bool;
  // an option whose show() returns false is hidden.  e.g.
  //   { text: 'Ask about the ring', to: 'ring', show: function (s) { return s.vars.warmth > 2; } }
  function choice(options)      { return { op: 'choice', options: options }; }
  function music(name, opts)    { return { op: 'music', name: name, opts: opts || {} }; }
  function stopMusic(opts)      { return { op: 'stopMusic', opts: opts || {} }; }
  function sfx(name, opts)      { return { op: 'sfx', name: name, opts: opts || {} }; }
  function pause(ms)            { return { op: 'pause', ms: ms }; }
  function fx(effect, opt)      { var o = { op: 'fx', effect: effect }; if (opt) for (var k in opt) o[k] = opt[k]; return o; }
  // PlayTestLog(message, level) - print a line to the playtest.py terminal as
  // the story runs (dev only; a shipped game has no console and drops it).
  //   message : a string, OR a function that returns something to show (it is
  //             passed the state object: s => `warmth is ${s.vars.warmth}`),
  //             OR any value - objects are JSON-stringified.
  //   level   : 'normal' (default, dim) | 'warning' (amber) | 'critical' (red)
  function PlayTestLog(message, level) { return { op: 'log', message: message, level: level || 'normal' }; }
  function saveOp(label)        { return { op: 'save', label: label || null }; }
  function chapterEnd(t, next)  { return { op: 'chapterEnd', title: t, next: next || null }; }
  function toMenu()             { return { op: 'toTitle' }; }

  global.say = say;
  global.narr = narr;
  global.mc = mc;
  global.bg = bg;
  global.placement = placement;
  global.show = show;
  global.hide = hide;
  global.move = move;
  global.label = label;
  global.jump = jump;
  global.iff = iff;
  global.set = set;
  global.abs = abs;
  global.choice = choice;
  global.music = music;
  global.stopMusic = stopMusic;
  global.sfx = sfx;
  global.pause = pause;
  global.fx = fx;
  global.PlayTestLog = PlayTestLog;
  global.saveOp = saveOp;
  global.chapterEnd = chapterEnd;
  global.toMenu = toMenu;
})(window);
